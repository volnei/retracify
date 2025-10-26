import path from "path";
import fs from "fs/promises";
import glob from "fast-glob";
import os from "os";
import ejs from "ejs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import type { PkgInfo } from "./types.js";

const requireForResolve = createRequire(import.meta.url);

interface AliasTargetEntry {
  template: string;
  hasWildcard: boolean;
}

interface AliasPatternEntry {
  matcher: RegExp;
  hasWildcard: boolean;
  targets: AliasTargetEntry[];
}

export interface TsconfigAliasResolver {
  configPath: string;
  scopeDir: string;
  scopeDirWithSep: string;
  aliases: AliasPatternEntry[];
}

type AliasEntryMap = Map<string, AliasPatternEntry>;

const tsconfigAliasCache = new Map<string, AliasEntryMap>();

const SCRIPT_IGNORED_TOKENS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "node",
  "npx",
  "run",
  "exec",
  "env",
  "export",
  "set",
  "cross-env",
  "echo",
  "cat",
  "cp",
  "mv",
  "rm",
  "rmdir",
  "mkdir",
  "sleep",
  "wait",
  "test",
  "true",
  "false",
  "if",
  "then",
  "fi",
  "sh",
  "bash",
  "source",
  "cd",
  "time",
]);

const KNOWN_BIN_ALIASES: Record<string, string[]> = {
  autoprefixer: ["autoprefixer"],
  eslint: ["eslint"],
  prettier: ["prettier"],
  typescript: ["tsc", "tsserver"],
  tailwindcss: ["tailwind"],
  vite: ["vite"],
  vitest: ["vitest"],
  jest: ["jest"],
  webpack: ["webpack"],
  "webpack-cli": ["webpack"],
  rollup: ["rollup"],
  parcel: ["parcel"],
  nodemon: ["nodemon"],
  rimraf: ["rimraf"],
  "ts-node": ["ts-node"],
  "ts-node-dev": ["ts-node-dev"],
  prisma: ["prisma"],
  turbo: ["turbo"],
  nx: ["nx"],
  lerna: ["lerna"],
  "postcss-cli": ["postcss"],
  stylelint: ["stylelint"],
  sass: ["sass"],
  "node-sass": ["node-sass"],
  esbuild: ["esbuild"],
  "npm-run-all": ["npm-run-all", "run-s", "run-p"],
  wrangler: ["wrangler"],
  playwright: ["playwright"],
  cypress: ["cypress"],
};

interface ConfigPatternDescriptor {
  patterns: string[];
  deps: string[];
  matchDeclared?: RegExp[];
  dot?: boolean;
}

const CONFIG_DETECTIONS: ConfigPatternDescriptor[] = [
  {
    patterns: [
      "jest.config.{js,cjs,mjs,ts,cts,mts,json}",
      "jest.config.js",
      "jest.config.ts",
      "jest.config.json",
    ],
    deps: ["jest"],
    matchDeclared: [/^jest($|-)/i, /^ts-jest$/i, /^@jest\//i],
  },
  {
    patterns: ["vite.config.{js,cjs,mjs,ts,cts,mts}"] ,
    deps: ["vite"],
    matchDeclared: [/^vite$|^vite-/i],
  },
  {
    patterns: ["vitest.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["vitest"],
    matchDeclared: [/^vitest($|-)/i],
  },
  {
    patterns: ["webpack.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["webpack"],
    matchDeclared: [/^webpack($|-)/i, /^webpack-cli$/i, /^webpack-dev-server$/i],
  },
  {
    patterns: ["rollup.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["rollup"],
    matchDeclared: [/^rollup($|-)/i, /^@rollup\//i],
  },
  {
    patterns: [
      "babel.config.{js,cjs,mjs,ts,cts,mts,json}",
      ".babelrc",
      ".babelrc.{js,cjs,mjs,json,yml,yaml}",
    ],
    deps: ["@babel/core"],
    matchDeclared: [/^@babel\//i],
    dot: true,
  },
  {
    patterns: ["cypress.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["cypress"],
    matchDeclared: [/^cypress($|-)/i],
  },
  {
    patterns: ["playwright.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["@playwright/test"],
    matchDeclared: [/^@playwright\//i],
  },
  {
    patterns: ["svelte.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["svelte"],
    matchDeclared: [/^svelte($|-)/i],
  },
  {
    patterns: ["astro.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["astro"],
    matchDeclared: [/^astro($|-)/i],
  },
  {
    patterns: ["next.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["next"],
    matchDeclared: [/^next($|-)/i],
  },
  {
    patterns: ["nuxt.config.{js,cjs,mjs,ts,cts,mts}"],
    deps: ["nuxt"],
    matchDeclared: [/^nuxt($|-)/i],
  },
];

/**
 * Walk the workspace and discover every package.json, excluding nested package
 * directories when counting source files so parents do not inherit child stats.
 */
export async function discoverPackages(
  rootDir: string,
  exclude: string[] = ["**/node_modules/**", "**/build/**", "**/dist/**"],
  onProgress?: (msg: string, progress?: number) => void,
): Promise<PkgInfo[]> {
  const rootDirResolved = path.resolve(rootDir);
  onProgress?.("Searching for package.json files...");
  const files = await glob(`${rootDirResolved}/**/package.json`, {
    ignore: exclude,
    onlyFiles: true,
  });
  onProgress?.(`Found ${files.length} package.json files`);

  const pkgs: PkgInfo[] = [];
  const packageDirs = files.map((filePath) =>
    path.resolve(path.dirname(filePath)),
  );

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const pkgDir = path.dirname(filePath);
    const pkgDirResolved = path.resolve(pkgDir);
    const content = await fs.readFile(filePath, "utf8");
    const pkg = JSON.parse(content);
    const dependencies = Object.keys(pkg.dependencies || {});
    const devDependencies = Object.keys(pkg.devDependencies || {});
    const declaredDeps = Array.from(
      new Set([...dependencies, ...devDependencies]),
    );

    const childPackageDirs = packageDirs.filter(
      (dir) =>
        dir !== pkgDirResolved &&
        dir.startsWith(pkgDirResolved.endsWith(path.sep)
          ? pkgDirResolved
          : `${pkgDirResolved}${path.sep}`),
    );
    let hasTsconfig = false;
    let hasTailwindConfig = false;
    let hasAutoprefixer = false;
    let hasEslintConfig = Boolean(pkg.eslintConfig);
    try {
      await fs.access(path.join(pkgDir, "tsconfig.json"));
      hasTsconfig = true;
    } catch {
      hasTsconfig = false;
    }

    const childIgnorePatterns = childPackageDirs
      .map((childDir) => {
        const relative = path.relative(pkgDirResolved, childDir);
        if (!relative || relative.startsWith("..")) return null;
        const normalized = relative.split(path.sep).join("/");
        return `${normalized}/**`;
      })
      .filter(Boolean) as string[];

    const scriptToolingDeps = detectScriptToolingDeps(
      pkg.scripts,
      dependencies,
      devDependencies,
    );
    const configToolingDeps = new Set<string>();

    if (!hasTailwindConfig) {
      const tailwindMatches = await glob(
        "tailwind.config.{js,cjs,mjs,ts,cts,mts}",
        {
          cwd: pkgDir,
          ignore: [
            ...childIgnorePatterns,
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
          ],
        },
      );
      const matched = Array.isArray(tailwindMatches)
        ? tailwindMatches.length > 0
        : Boolean(tailwindMatches);
      if (matched) {
        hasTailwindConfig = true;
        configToolingDeps.add("tailwindcss");
      }
    }

    if (!hasAutoprefixer) {
      const postcssMatches = await glob(
        "postcss.config.{js,cjs,mjs,ts,cts,mts}",
        {
          cwd: pkgDir,
          ignore: [
            ...childIgnorePatterns,
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
          ],
        },
      );
      if (Array.isArray(postcssMatches) && postcssMatches.length > 0) {
        for (const match of postcssMatches) {
          try {
            const configContent = await fs.readFile(
              path.resolve(pkgDir, match),
              "utf8",
            );
            if (configContent.includes("autoprefixer")) {
              hasAutoprefixer = true;
              configToolingDeps.add("autoprefixer");
              break;
            }
          } catch {
            // Ignore config files that cannot be read
          }
        }
      }
    }

    if (!hasEslintConfig) {
      const eslintrcMatches = await glob(
        ".eslintrc{,.js,.cjs,.mjs,.ts,.json,.yml,.yaml}",
        {
          cwd: pkgDir,
          ignore: [
            ...childIgnorePatterns,
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
          ],
          dot: true,
        },
      );
      hasEslintConfig = Array.isArray(eslintrcMatches)
        ? eslintrcMatches.length > 0
        : Boolean(eslintrcMatches);
    }

    if (!hasEslintConfig) {
      const flatEslintMatches = await glob(
        "eslint.config.{js,cjs,mjs,ts,cts,mts}",
        {
          cwd: pkgDir,
          ignore: [
            ...childIgnorePatterns,
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
          ],
        },
      );
      const matched = Array.isArray(flatEslintMatches)
        ? flatEslintMatches.length > 0
        : Boolean(flatEslintMatches);
      if (matched) {
        hasEslintConfig = true;
      }
    }

    if (hasEslintConfig) {
      configToolingDeps.add("eslint");
      collectMatchingDeps(declaredDeps, [
        /^eslint($|-)/i,
        /^@eslint\//i,
        /^@typescript-eslint\//i,
        /^eslint-plugin-/i,
        /^eslint-config-/i,
        /^eslint-parser/i,
      ]).forEach((dep) => configToolingDeps.add(dep));
    }

    await addConfigToolingFromPatterns(
      pkgDir,
      childIgnorePatterns,
      configToolingDeps,
      declaredDeps,
    );

    const toolingDeps = Array.from(
      new Set([...scriptToolingDeps, ...configToolingDeps]),
    );

    const filesInPkg = await glob("**/*.{js,ts,jsx,tsx}", {
      cwd: pkgDir,
      absolute: true,
      ignore: [
        ...exclude,
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        ...childIgnorePatterns,
      ],
    });

    pkgs.push({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description || "",
      dir: pkgDir,
      declaredDeps,
      declaredProdDeps: dependencies,
      declaredDevDeps: devDependencies,
      hasTsconfig,
      hasTailwindConfig,
      hasAutoprefixer,
      hasEslintConfig,
      hasChildPackages: childPackageDirs.length > 0,
      toolingDeps,
      fileCount: filesInPkg.length,
    });

    onProgress?.(
      `Processed ${i + 1}/${files.length} packages`,
      ((i + 1) / files.length) * 100,
    );
  }

  return pkgs;
}

// Return all source files in the workspace; shared between graph building and
// import analysis steps.
export async function collectSourceFiles(
  rootDir: string,
  exclude: string[] = ["**/node_modules/**", "**/build/**", "**/dist/**"],
  onProgress?: (msg: string) => void,
): Promise<string[]> {
  const rootDirResolved = path.resolve(rootDir);
  onProgress?.("Searching for source files...");
  const files = await glob(`${rootDirResolved}/**/*.{js,ts,jsx,tsx}`, {
    ignore: exclude,
  });
  onProgress?.(`Found ${files.length} source files`);
  return files;
}

export function normalizeImportSpecifier(spec: string): string {
  if (spec.startsWith("@")) {
    const [scope, name] = spec.split("/");
    return name ? `${scope}/${name}` : spec;
  }
  return spec.split("/")[0];
}

export function serializeReportToJson(reportData: {
  packages: {
    name: string;
    version?: string;
    description?: string;
    relativeDir?: string;
    isRoot?: boolean;
    dependencies: string[];
    references: number;
    cyclicDeps: string[];
    declaredDeps: string[];
    undeclaredDeps: string[];
    fileCount?: number;
    hasTsconfig?: boolean;
    hasTailwindConfig?: boolean;
    hasAutoprefixer?: boolean;
    hasEslintConfig?: boolean;
    hasChildPackages?: boolean;
    toolingDeps?: string[];
    externalDependencies: {
      name: string;
      isDeclared: boolean;
      isUsed: boolean;
      usageCount: number;
      declaredInDependencies: boolean;
      declaredInDevDependencies: boolean;
      isLikelyTypePackage: boolean;
      isToolingOnly: boolean;
    }[];
    undeclaredExternalDeps: string[];
    unusedExternalDeps: string[];
  }[];
  rootDir: string;
}): string {
  return JSON.stringify(reportData, null, 2);
}

export async function renderHtmlReport(
  reportData: {
    packages: {
      name: string;
      version?: string;
      description?: string;
      relativeDir?: string;
      isRoot?: boolean;
      dependencies: string[];
      references: number;
      cyclicDeps: string[];
      declaredDeps: string[];
      undeclaredDeps: string[];
      fileCount?: number;
      hasTsconfig?: boolean;
      hasTailwindConfig?: boolean;
      hasAutoprefixer?: boolean;
      hasEslintConfig?: boolean;
      hasChildPackages?: boolean;
      toolingDeps?: string[];
      externalDependencies: {
        name: string;
        isDeclared: boolean;
        isUsed: boolean;
        usageCount: number;
        declaredInDependencies: boolean;
        declaredInDevDependencies: boolean;
        isLikelyTypePackage: boolean;
        isToolingOnly: boolean;
      }[];
      undeclaredExternalDeps: string[];
      unusedExternalDeps: string[];
    }[];
    rootDir: string;
  },
  projectRoot: string,
): Promise<string> {
  const now = new Date().toLocaleString();
  const systemInfo = `${os.type()} ${os.release()} (${os.arch()})`;
  const nodeVersion = process.version;

  const makeId = (name: string) =>
    name.replace(/[@/]/g, "-").replace(/^-+|-+$/g, "");

  const summary = {
    packageCount: reportData.packages.length,
    dependencyCount: 0,
    cyclicDependencyCount: 0,
    undeclaredDependencyCount: 0,
    runtimeExternalCount: 0,
    toolingExternalCount: 0,
    typeExternalCount: 0,
    toolingDependencyCount: 0,
    packagesWithIssues: 0,
  };

  const packagesView = reportData.packages.map((pkg, index) => {
    const displayName =
      typeof pkg.name === "string" && pkg.name.trim().length > 0
        ? pkg.name
        : typeof pkg.relativeDir === "string" && pkg.relativeDir.trim().length > 0
          ? pkg.relativeDir
          : `package-${index + 1}`;

    const anchorId = makeId(displayName);
    const toolingList = Array.isArray(pkg.toolingDeps)
      ? Array.from(new Set(pkg.toolingDeps)).sort()
      : [];
    const runtimeExternal = pkg.externalDependencies.filter(
      (dep) => !dep.isToolingOnly && !dep.isLikelyTypePackage,
    ).length;
    const toolingExternal = pkg.externalDependencies.filter(
      (dep) => dep.isToolingOnly,
    ).length;
    const typeExternal = pkg.externalDependencies.filter(
      (dep) => dep.isLikelyTypePackage,
    ).length;
    const hasIssues =
      (pkg.undeclaredDeps?.length ?? 0) > 0 ||
      (pkg.undeclaredExternalDeps?.length ?? 0) > 0 ||
      (pkg.unusedExternalDeps?.length ?? 0) > 0;

    summary.dependencyCount += pkg.dependencies.length;
    summary.cyclicDependencyCount += pkg.cyclicDeps.length;
    summary.undeclaredDependencyCount += pkg.undeclaredDeps.length;
    summary.runtimeExternalCount += runtimeExternal;
    summary.toolingExternalCount += toolingExternal;
    summary.typeExternalCount += typeExternal;
    summary.toolingDependencyCount += toolingList.length;
    if (hasIssues) summary.packagesWithIssues += 1;

    return {
      ...pkg,
      displayName,
      anchorId,
      cyclicCount: pkg.cyclicDeps.length,
      runtimeExternalCount: runtimeExternal,
      toolingExternalCount: toolingExternal,
      typeExternalCount: typeExternal,
      toolingDepsList: toolingList,
      hasIssues,
      dependencyBadges: pkg.dependencies.map((dep) => ({
        name: dep,
        anchor: makeId(dep),
        isCyclic: pkg.cyclicDeps.includes(dep),
        isUndeclared: pkg.undeclaredDeps.includes(dep),
      })),
      externalDependencies: pkg.externalDependencies,
      externalDependencyBadges: pkg.externalDependencies.map((dep) => {
        const isTypeOnly = dep.isLikelyTypePackage && !dep.isUsed;
        const isToolingOnly = dep.isToolingOnly && dep.usageCount === 0;
        const statusLabel = dep.isDeclared
          ? dep.isUsed
            ? isToolingOnly
              ? "Declared • Tooling"
              : "Declared • Used"
            : isTypeOnly
              ? "Declared • Type-only"
              : "Declared • Unused"
          : "Undeclared";
        let scopeLabel: string | null = null;
        let scopeToneClass = "";
        if (dep.isDeclared) {
          if (dep.declaredInDependencies && dep.declaredInDevDependencies) {
            scopeLabel = "Prod+Dev";
            scopeToneClass = "bg-amber-500/25 text-amber-100";
          } else if (dep.declaredInDependencies) {
            scopeLabel = "Prod";
            scopeToneClass = "bg-emerald-500/20 text-emerald-100";
          } else if (dep.declaredInDevDependencies) {
            scopeLabel = "Dev";
            scopeToneClass = "bg-sky-500/25 text-sky-100";
          }
        }
        return {
          ...dep,
          statusLabel,
          scopeLabel,
          scopeToneClass,
          isTypeOnly,
          isToolingOnly,
        };
      }),
      unusedExternalCount: pkg.unusedExternalDeps.length,
      undeclaredExternalCount: pkg.undeclaredExternalDeps.length,
    };
  });

  const averageDependencyCount =
    summary.packageCount > 0
      ? Number((summary.dependencyCount / summary.packageCount).toFixed(1))
      : 0;
  const averageToolingDeps =
    summary.packageCount > 0
      ? Number((summary.toolingDependencyCount / summary.packageCount).toFixed(1))
      : 0;

  const summaryView = {
    ...summary,
    averageDependencyCount,
    averageToolingDeps,
  };

  const clientPayload = JSON.stringify({
    summary: summaryView,
    packages: packagesView,
    meta: {
      rootDir: reportData.rootDir,
      generatedAt: now,
      systemInfo,
      nodeVersion,
    },
  }).replace(/</g, "\\u003c");

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const bundledTemplatesDir = path.resolve(moduleDir, "../templates");
  const templateCandidates = ["reports.ejs", "report.ejs"];
  const searchDirs = [bundledTemplatesDir];

  const projectTemplatesDir = path.resolve(projectRoot, "templates");
  if (!searchDirs.includes(projectTemplatesDir)) {
    searchDirs.push(projectTemplatesDir);
  }

  let templatePath: string | null = null;
  let templateContent: string | null = null;
  let resolvedTemplatesDir: string | null = null;
  for (const dir of searchDirs) {
    for (const candidate of templateCandidates) {
      const candidatePath = path.resolve(dir, candidate);
      try {
        const candidateContent = await fs.readFile(candidatePath, "utf8");
        if (typeof candidateContent === "string") {
          templatePath = candidatePath;
          templateContent = candidateContent;
          resolvedTemplatesDir = dir;
          break;
        }
      } catch {
        // Try next candidate
      }
    }
    if (templatePath) {
      break;
    }
  }

  if (!templatePath || templateContent === null) {
    throw new Error(
      `Template file not found in any of the expected locations. Checked: ${searchDirs
        .map((dir) =>
          templateCandidates.map((name) => path.resolve(dir, name)).join(", "),
        )
        .join("; ")}.`,
    );
  }

  const templatesDir = resolvedTemplatesDir ?? path.dirname(templatePath);

  return ejs.render(
    templateContent,
    {
      reportData,
      now,
      systemInfo,
      nodeVersion,
      clientPayload,
    },
    {
      views: [templatesDir],
      filename: templatePath,
    },
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function detectScriptToolingDeps(
  scripts: Record<string, unknown> | undefined,
  dependencies: string[],
  devDependencies: string[],
): string[] {
  if (!scripts || typeof scripts !== "object") return [];
  const scriptEntries = Object.entries(scripts).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (scriptEntries.length === 0) return [];

  const scriptNames = new Set(
    scriptEntries.map(([name]) => name.toLowerCase()),
  );
  const allDeps = Array.from(
    new Set([...dependencies, ...devDependencies]),
  );
  if (allDeps.length === 0) return [];

  const depBinMap = buildDependencyBinMap(allDeps);
  if (depBinMap.size === 0) return [];

  const usedDeps = new Set<string>();
  for (const [, raw] of scriptEntries) {
    const tokens = tokenizeScriptValue(raw);
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (scriptNames.has(lower)) continue;
      for (const [dep, bins] of depBinMap) {
        if (bins.has(lower)) {
          usedDeps.add(dep);
        }
      }
    }
  }
  return Array.from(usedDeps);
}

function collectMatchingDeps(
  declaredDeps: string[],
  patterns: RegExp[],
): string[] {
  if (!declaredDeps.length || !patterns.length) return [];
  const matches: string[] = [];
  for (const dep of declaredDeps) {
    if (patterns.some((regex) => regex.test(dep))) {
      matches.push(dep);
    }
  }
  return matches;
}

async function addConfigToolingFromPatterns(
  pkgDir: string,
  childIgnorePatterns: string[],
  configToolingDeps: Set<string>,
  declaredDeps: string[],
): Promise<void> {
  for (const detection of CONFIG_DETECTIONS) {
    let matched = false;
    for (const pattern of detection.patterns) {
      const matches = await glob(pattern, {
        cwd: pkgDir,
        ignore: [
          ...childIgnorePatterns,
          "**/node_modules/**",
          "**/dist/**",
          "**/build/**",
        ],
        dot: detection.dot ?? pattern.startsWith("."),
      });
      const hasMatch = Array.isArray(matches)
        ? matches.length > 0
        : Boolean(matches);
      if (hasMatch) {
        matched = true;
        break;
      }
    }
    if (matched) {
      detection.deps.forEach((dep) => configToolingDeps.add(dep));
      if (detection.matchDeclared) {
        collectMatchingDeps(declaredDeps, detection.matchDeclared).forEach(
          (dep) => configToolingDeps.add(dep),
        );
      }
    }
  }
}

function tokenizeScriptValue(value: string): string[] {
  const sanitized = value
    .replace(/&&|\|\||;|\||\(|\)|\{|\}|\[|\]|>>|<</g, " ")
    .replace(/\r?\n/g, " ");
  const tokens: string[] = [];
  for (const rawPart of sanitized.split(/\s+/)) {
    if (!rawPart) continue;
    if (rawPart.includes("=") && !rawPart.startsWith("--")) continue;
    if (rawPart.startsWith("$")) continue;
    if (rawPart.startsWith("-")) continue;
    let token = rawPart.replace(/^['"]+|['"]+$/g, "");
    token = token.replace(/^\.\/node_modules\/\.bin\//, "");
    token = token.replace(/^node_modules\/\.bin\//, "");
    token = token.replace(/^npm:/, "");
    token = token.replace(/^pnpm:/, "");
    const parts = token.split("/");
    token = parts[parts.length - 1];
    if (!token) continue;
    token = token.replace(/:.+$/, "").trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    if (lower.startsWith("--")) continue;
    if (SCRIPT_IGNORED_TOKENS.has(lower)) continue;
    tokens.push(token);
  }
  return tokens;
}

function buildDependencyBinMap(dependencies: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const dep of dependencies) {
    const bins = new Set<string>();
    const lowerDep = dep.toLowerCase();
    bins.add(lowerDep);
    const base = dep.split("/").pop();
    if (base) {
      bins.add(base.toLowerCase());
      bins.add(base.replace(/-/g, "").toLowerCase());
    }
    const aliases = KNOWN_BIN_ALIASES[lowerDep];
    if (aliases) {
      aliases.forEach((alias) => bins.add(alias.toLowerCase()));
    }
    map.set(dep, bins);
  }
  return map;
}

function stripJsonComments(content: string): string {
  let output = "";
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (inString) {
      output += char;
      if (char === "\\" && next) {
        output += next;
        i += 1;
        continue;
      }
      if (char === stringChar) {
        inString = false;
        stringChar = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      stringChar = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") i += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < content.length) {
        if (content[i] === "*" && content[i + 1] === "/") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    output += char;
  }
  return output;
}

async function readJsonWithComments(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  const cleaned = stripJsonComments(raw);
  return JSON.parse(cleaned);
}

function resolveExtendsReference(ref: string, fromDir: string): string | null {
  if (!ref) return null;
  if (ref.startsWith(".")) return path.resolve(fromDir, ref);
  if (path.isAbsolute(ref)) return ref;
  try {
    return requireForResolve.resolve(ref, { paths: [fromDir] });
  } catch {
    try {
      return requireForResolve.resolve(`${ref}.json`, { paths: [fromDir] });
    } catch {
      return null;
    }
  }
}

function createAliasEntry(
  pattern: string,
  targets: AliasTargetEntry[],
): AliasPatternEntry {
  const hasWildcard = pattern.includes("*");
  const regexPattern = escapeRegExp(pattern).replace(/\\\*/g, "(.+)");
  const matcher = new RegExp(`^${regexPattern}$`);
  return { matcher, hasWildcard, targets };
}

async function buildAliasMapForConfig(
  configPath: string,
  seen: Set<string> = new Set(),
): Promise<AliasEntryMap> {
  const normalizedPath = path.resolve(configPath);
  const cached = tsconfigAliasCache.get(normalizedPath);
  if (cached) return cached;
  if (seen.has(normalizedPath)) return new Map();
  seen.add(normalizedPath);

  let parsed: unknown;
  try {
    parsed = await readJsonWithComments(normalizedPath);
  } catch {
    const empty = new Map();
    tsconfigAliasCache.set(normalizedPath, empty);
    return empty;
  }

  const result: AliasEntryMap = new Map();

  const tsconfig = isRecord(parsed) ? parsed : undefined;
  const extendsPath =
    typeof tsconfig?.extends === "string" ? tsconfig.extends : undefined;

  if (extendsPath) {
    const parentPath = resolveExtendsReference(
      extendsPath,
      path.dirname(normalizedPath),
    );
    if (parentPath) {
      const parentMap = await buildAliasMapForConfig(parentPath, seen);
      parentMap.forEach((value, key) => {
        result.set(key, value);
      });
    }
  }

  const compilerOptions = isRecord(tsconfig?.compilerOptions)
    ? (tsconfig.compilerOptions as Record<string, unknown>)
    : undefined;
  const pathsOption = isRecord(compilerOptions?.paths)
    ? (compilerOptions.paths as Record<string, unknown>)
    : undefined;
  if (pathsOption) {
    const baseDir =
      typeof compilerOptions?.baseUrl === "string"
        ? path.resolve(path.dirname(normalizedPath), compilerOptions.baseUrl)
        : path.dirname(normalizedPath);

    for (const [aliasKey, aliasTargets] of Object.entries(pathsOption)) {
      if (!Array.isArray(aliasTargets)) continue;
      const normalizedTargets: AliasTargetEntry[] = aliasTargets
        .filter((target): target is string => typeof target === "string")
        .map((target) => ({
          template: path.resolve(baseDir, target),
          hasWildcard: target.includes("*"),
        }));
      if (normalizedTargets.length === 0) continue;
      result.set(aliasKey, createAliasEntry(aliasKey, normalizedTargets));
    }
  }

  tsconfigAliasCache.set(normalizedPath, result);
  return result;
}

export async function loadTsconfigAliasResolvers(
  rootDir: string,
  exclude: string[] = ["**/node_modules/**", "**/dist/**", "**/build/**"],
): Promise<TsconfigAliasResolver[]> {
  const rootDirResolved = path.resolve(rootDir);
  const files = await glob(`${rootDirResolved}/**/tsconfig.json`, {
    ignore: exclude,
    onlyFiles: true,
  });

  const resolvers: TsconfigAliasResolver[] = [];

  for (const filePath of files) {
    try {
      const aliasMap = await buildAliasMapForConfig(filePath);
      if (!aliasMap.size) continue;
      const scopeDir = path.dirname(filePath);
      resolvers.push({
        configPath: filePath,
        scopeDir,
        scopeDirWithSep: ensureTrailingSlash(scopeDir),
        aliases: Array.from(aliasMap.values()),
      });
    } catch {
      // Ignore configs we cannot parse
    }
  }

  resolvers.sort(
    (a, b) => b.scopeDirWithSep.length - a.scopeDirWithSep.length,
  );
  return resolvers;
}

export function resolvePathAliasImport(
  specifier: string,
  fromFile: string,
  resolvers: TsconfigAliasResolver[],
): string[] {
  if (!resolvers.length) return [];
  const normalizedFrom = path.resolve(fromFile);
  const matches: string[] = [];

  for (const resolver of resolvers) {
    const withinScope =
      normalizedFrom === resolver.scopeDir ||
      normalizedFrom.startsWith(resolver.scopeDirWithSep);
    if (!withinScope) {
      continue;
    }

    for (const alias of resolver.aliases) {
      const match = alias.matcher.exec(specifier);
      if (!match) continue;
      const wildcardValue =
        alias.hasWildcard && match.length > 1
          ? match.slice(1).join("/")
          : "";
      for (const target of alias.targets) {
        const candidate = target.hasWildcard
          ? target.template.replace("*", wildcardValue)
          : target.template;
        matches.push(candidate);
      }
    }
  }

  return matches;
}
