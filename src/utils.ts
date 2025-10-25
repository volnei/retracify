import path from "path";
import fs from "fs/promises";
import glob from "fast-glob";
import os from "os";
import ejs from "ejs";
import { fileURLToPath } from "url";
import type { PkgInfo } from "./types.js";

export async function detectPackages(
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

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const pkgDir = path.dirname(filePath);
    const content = await fs.readFile(filePath, "utf8");
    const pkg = JSON.parse(content);

    const filesInPkg = await glob("**/*.{js,ts,jsx,tsx}", {
      cwd: pkgDir,
      absolute: true,
      ignore: [
        ...exclude,
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
      ],
    });

    pkgs.push({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description || "",
      dir: pkgDir,
      declaredDeps: Object.keys({
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      }),
      fileCount: filesInPkg.length,
    });

    onProgress?.(
      `Processed ${i + 1}/${files.length} packages`,
      ((i + 1) / files.length) * 100,
    );
  }

  return pkgs;
}

export async function findSourceFiles(
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

export function normalizePackageName(spec: string): string {
  if (spec.startsWith("@")) {
    const [scope, name] = spec.split("/");
    return name ? `${scope}/${name}` : spec;
  }
  return spec.split("/")[0];
}

export function createJsonReport(reportData: {
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
  }[];
  rootDir: string;
}): string {
  return JSON.stringify(reportData, null, 2);
}

export async function createHtmlTemplate(
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

  const packagesView = reportData.packages.map((pkg, index) => {
    const displayName =
      typeof pkg.name === "string" && pkg.name.trim().length > 0
        ? pkg.name
        : typeof pkg.relativeDir === "string" && pkg.relativeDir.trim().length > 0
          ? pkg.relativeDir
          : `package-${index + 1}`;

    const anchorId = makeId(displayName);

    return {
      ...pkg,
      displayName,
      anchorId,
      cyclicCount: pkg.cyclicDeps.length,
      dependencyBadges: pkg.dependencies.map((dep) => ({
        name: dep,
        anchor: makeId(dep),
        isCyclic: pkg.cyclicDeps.includes(dep),
        isUndeclared: pkg.undeclaredDeps.includes(dep),
      })),
    };
  });

  const summary = {
    packageCount: packagesView.length,
    dependencyCount: 0,
    cyclicDependencyCount: 0,
    undeclaredDependencyCount: 0,
  };

  for (const pkg of packagesView) {
    summary.dependencyCount += pkg.dependencies.length;
    summary.cyclicDependencyCount += pkg.cyclicCount;
    summary.undeclaredDependencyCount += pkg.undeclaredDeps.length;
  }

  const averageDependencyCount =
    summary.packageCount > 0
      ? Number((summary.dependencyCount / summary.packageCount).toFixed(1))
      : 0;

  const summaryView = {
    ...summary,
    averageDependencyCount,
  };

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
      makeId,
      packagesView,
      summary: summaryView,
    },
    {
      views: [templatesDir],
      filename: templatePath,
    },
  );
}
