import path from "path";
import { builtinModules } from "module";
import { createHash } from "node:crypto";
import { readFile, stat } from "fs/promises";
import ts from "typescript";
import type {
  EdgeMap,
  GenerateReportOptions,
  GenerateReportSnapshotEvent,
  ReportPackage,
  DependencyReport,
  PkgInfo,
} from "./types.js";
import {
  discoverPackages,
  collectSourceFiles,
  normalizeImportSpecifier,
  loadTsconfigAliasResolvers,
  resolvePathAliasImport,
  type TsconfigAliasResolver,
} from "./utils.js";

// Create a quick lookup so we can resolve files to the closest owning package.
export function buildPackageDirectoryMap(
  pkgList: PkgInfo[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkg of pkgList) map.set(pkg.dir, pkg.name);
  return map;
}

// Given a source file, choose the most specific package directory that owns it.
export function resolvePackageForFile(
  filePath: string,
  pkgDirMap: Map<string, string>,
): string | null {
  const absoluteFilePath = path.resolve(filePath);
  const entries = Array.from(pkgDirMap.entries()).sort(
    ([dirA], [dirB]) => dirB.length - dirA.length,
  );

  for (const [dir, pkgName] of entries) {
    const absoluteDir = path.resolve(dir);
    const relative = path.relative(absoluteDir, absoluteFilePath);
    const isWithinDir =
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

    if (isWithinDir) return pkgName;
  }

  return null;
}

type ProgressCallback = (msg: string, progress?: number) => void;

const BUILTIN_MODULE_SET = new Set<string>(
  builtinModules.flatMap((mod) =>
    mod.startsWith("node:") ? [mod, mod.slice(5)] : [mod, `node:${mod}`],
  ),
);

const DECLARATION_FILE_REGEX = /\.d\.(cts|mts|ts)$/i;

function determineScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".ts")) return ts.ScriptKind.TS;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".mjs") || filePath.endsWith(".cjs"))
    return ts.ScriptKind.JS;
  if (filePath.endsWith(".cts")) return ts.ScriptKind.TS;
  if (filePath.endsWith(".mts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function createWorkspaceResolver(
  pkgNames: Set<string>,
): (specifier: string) => string | null {
  return (spec: string) => {
    if (!spec) return null;
    const segments = spec.split("/");

    if (spec.startsWith("@")) {
      for (let i = segments.length; i >= 2; i--) {
        const candidate = segments.slice(0, i).join("/");
        if (pkgNames.has(candidate)) return candidate;
      }
    } else {
      for (let i = segments.length; i >= 1; i--) {
        const candidate = segments.slice(0, i).join("/");
        if (pkgNames.has(candidate)) return candidate;
      }
    }

    const normalized = normalizeImportSpecifier(spec);
    return pkgNames.has(normalized) ? normalized : null;
  };
}

function isTypeOnlyImportDeclaration(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((el) => el.isTypeOnly)
  ) {
    return !clause.name;
  }
  return false;
}

function isTypeOnlyExportDeclaration(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  if (
    node.exportClause &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0
  ) {
    return node.exportClause.elements.every((el) => el.isTypeOnly);
  }
  return false;
}

async function analyzeSourceFile(
  filePath: string,
  pkgDirMap: Map<string, string>,
  pkgNames: Set<string>,
  aliasResolvers: TsconfigAliasResolver[],
): Promise<FileAnalysis> {
  const fromPkg = resolvePackageForFile(filePath, pkgDirMap);
  const defaultResult: FileAnalysis = {
    filePath,
    pkgName: fromPkg,
    hash: null,
    internalReferenceCounts: {},
    internalDependencies: [],
    externalReferenceCounts: {},
  };

  if (!fromPkg) return defaultResult;

  let sourceText: string;
  try {
    sourceText = await readFile(filePath, "utf8");
  } catch {
    return defaultResult;
  }

  const contentHash = createHash("sha1").update(sourceText).digest("hex");

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    determineScriptKind(filePath),
  );

  const resolveTargetPackage = createWorkspaceResolver(pkgNames);
  const internalReferenceCounts: Record<string, number> = {};
  const internalDependencies = new Set<string>();
  const externalReferenceCounts: Record<string, number> = {};
  const isDeclarationFile = DECLARATION_FILE_REGEX.test(filePath);
  type ImportMeta = { isTypeOnly?: boolean };

  const recordInternalDependency = (target: string) => {
    internalDependencies.add(target);
    internalReferenceCounts[target] =
      (internalReferenceCounts[target] || 0) + 1;
  };

  const processImport = (spec: string, meta: ImportMeta = {}) => {
    if (!spec) return;
    if (
      spec.startsWith(".") ||
      spec.startsWith("..") ||
      spec.startsWith("/") ||
      spec.startsWith("file:")
    ) {
      return;
    }

    const treatAsTypeOnly = Boolean(meta.isTypeOnly || isDeclarationFile);

    const normalizedBuiltin = spec.startsWith("node:") ? spec.slice(5) : spec;
    if (
      BUILTIN_MODULE_SET.has(spec) ||
      BUILTIN_MODULE_SET.has(normalizedBuiltin)
    ) {
      return;
    }

    if (aliasResolvers.length > 0) {
      const aliasMatches = resolvePathAliasImport(
        spec,
        filePath,
        aliasResolvers,
      );
      for (const candidate of aliasMatches) {
        const aliasPkg = resolvePackageForFile(candidate, pkgDirMap);
        if (!aliasPkg) continue;
        if (aliasPkg === fromPkg) return;
        if (!treatAsTypeOnly) {
          recordInternalDependency(aliasPkg);
        }
        return;
      }
    }

    const target = resolveTargetPackage(spec);
    if (target && target !== fromPkg) {
      if (!treatAsTypeOnly) {
        recordInternalDependency(target);
      }
      return;
    }

    const externalName = normalizeImportSpecifier(spec);
    if (!externalName) return;
    externalReferenceCounts[externalName] =
      (externalReferenceCounts[externalName] || 0) + 1;
  };

  const extractSpecifierFromExpression = (
    expr: ts.Expression | undefined,
  ): string | null => {
    if (!expr) return null;
    if (ts.isStringLiteralLike(expr)) return expr.text;
    return null;
  };

  const propertyAccessAllowList = new Set([
    "require.resolve",
    "module.require",
    "jest.requireActual",
    "jest.requireMock",
    "jest.doMock",
    "jest.mock",
  ]);

  sourceFile.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = extractSpecifierFromExpression(
        statement.moduleSpecifier as ts.Expression,
      );
      if (specifier) {
        processImport(specifier, {
          isTypeOnly: isTypeOnlyImportDeclaration(statement),
        });
      }
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = extractSpecifierFromExpression(
        statement.moduleSpecifier as ts.Expression,
      );
      if (specifier) {
        processImport(specifier, {
          isTypeOnly: isTypeOnlyExportDeclaration(statement),
        });
      }
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      statement.moduleReference &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const specifier = extractSpecifierFromExpression(
        statement.moduleReference.expression,
      );
      if (specifier) {
        processImport(specifier, { isTypeOnly: Boolean(statement.isTypeOnly) });
      }
    }
  });

  const visit = (node: ts.Node) => {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      processImport(node.argument.literal.text, { isTypeOnly: true });
    }

    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const args = node.arguments;
      if (args.length > 0) {
        const spec = extractSpecifierFromExpression(args[0]);
        if (spec) {
          if (expr.kind === ts.SyntaxKind.ImportKeyword) {
            processImport(spec);
          } else if (ts.isIdentifier(expr)) {
            if (expr.text === "require") {
              processImport(spec);
            }
          } else if (ts.isPropertyAccessExpression(expr)) {
            const baseName = expr.expression.getText(sourceFile);
            const propertyName = expr.name.getText(sourceFile);
            if (propertyAccessAllowList.has(`${baseName}.${propertyName}`)) {
              processImport(spec);
            }
          }
        }
      }
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);

  return {
    filePath,
    pkgName: fromPkg,
    hash: contentHash,
    internalReferenceCounts,
    internalDependencies: Array.from(internalDependencies),
    externalReferenceCounts,
  };
}

function applyAnalysisToAggregated(
  analysis: FileAnalysis,
  aggregated: AggregatedGraphData,
) {
  const { pkgName } = analysis;
  if (!pkgName) return;

  if (analysis.internalDependencies.length) {
    if (!aggregated.edges.has(pkgName)) {
      aggregated.edges.set(pkgName, new Set());
    }
    if (!aggregated.dependencyOrigins.has(pkgName)) {
      aggregated.dependencyOrigins.set(pkgName, new Map());
    }
    const originMap = aggregated.dependencyOrigins.get(pkgName)!;

    for (const dep of analysis.internalDependencies) {
      aggregated.edges.get(pkgName)!.add(dep);
      const count = analysis.internalReferenceCounts[dep] || 0;
      if (count > 0) {
        aggregated.referenceCount[dep] =
          (aggregated.referenceCount[dep] || 0) + count;
      }
      if (!originMap.has(dep)) {
        originMap.set(dep, new Set());
      }
      originMap.get(dep)!.add(path.resolve(analysis.filePath));
    }
  }

  const externalEntries = Object.entries(analysis.externalReferenceCounts);
  if (externalEntries.length > 0) {
    if (!aggregated.externalReferenceCount[pkgName]) {
      aggregated.externalReferenceCount[pkgName] = {};
    }
    const externalMap = aggregated.externalReferenceCount[pkgName];
    for (const [name, count] of externalEntries) {
      externalMap[name] = (externalMap[name] || 0) + count;
    }
  }
}

function buildAggregatedGraphData(
  analyses: Iterable<FileAnalysis>,
): AggregatedGraphData {
  const aggregated: AggregatedGraphData = {
    edges: new Map(),
    referenceCount: {},
    externalReferenceCount: {},
    dependencyOrigins: new Map(),
  };

  for (const analysis of analyses) {
    applyAnalysisToAggregated(analysis, aggregated);
  }

  return aggregated;
}

// Depth-first search tracking the call stack to find cyclic dependency edges.
export function identifyCyclicEdges(
  edges: EdgeMap,
  onProgress?: (msg: string, progress?: number) => void,
): Set<string> {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const cyclicEdges = new Set<string>();
  const nodes = Array.from(edges.keys());
  const total = nodes.length;

  onProgress?.(`Detecting cycles among ${total} packages...`, 85);

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    stack.add(node);
    const deps = edges.get(node) || new Set();

    for (const dep of deps) {
      const edge = `${node}->${dep}`;
      if (stack.has(dep)) {
        cyclicEdges.add(edge);
        const idx = path.indexOf(dep);
        if (idx !== -1) {
          for (let i = idx; i < path.length; i++) {
            const from = path[i];
            const to = path[i + 1] || node;
            cyclicEdges.add(`${from}->${to}`);
          }
        }
      } else if (!visited.has(dep)) dfs(dep, [...path, node]);
    }

    stack.delete(node);
  }

  nodes.forEach((node, i) => {
    if (!visited.has(node)) dfs(node, []);
    if (i % 20 === 0) {
      const progress = 85 + (i / total) * 5;
      onProgress?.(`Cycle detection: ${i + 1}/${total}`, progress);
    }
  });

  onProgress?.(
    `Cycle detection completed (${cyclicEdges.size} cyclic edges found)`,
    90,
  );
  return cyclicEdges;
}

interface AnalysisCallbacks {
  onProgress?: ProgressCallback;
  onStateChange?: (state: {
    filePath: string;
    filesProcessed: number;
    totalFiles: number;
    message: string;
    progress?: number;
    edges: EdgeMap;
    referenceCount: Record<string, number>;
    externalReferenceCount: Record<string, Record<string, number>>;
    dependencyOrigins: Map<string, Map<string, Set<string>>>;
  }) => void;
}

interface ReportAssemblyContext {
  pkgInfoList: PkgInfo[];
  pkgDirByName: Map<string, string>;
  workspaceNames: Set<string>;
  resolvedRoot: string;
}

const TYPE_PACKAGE_PATTERNS = [/^@types\//i, /-types$/i, /^types[-/]/i];

const KNOWN_TOOLING_PATTERNS = [
  /^prettier$/i,
  /^prettier-/i,
  /^eslint$/i,
  /^eslint-/i,
  /^@eslint\//i,
  /^@typescript-eslint\//i,
  /^eslint-plugin-/i,
  /^eslint-config-/i,
  /^eslint-parser$/i,
  /^eslint-import$/i,
  /^stylelint$/i,
  /^stylelint-/i,
  /^@stylelint\//i,
  /^lint-staged$/i,
  /^husky$/i,
  /^commitlint$/i,
  /^@commitlint\//i,
  /^babel$/i,
  /^@babel\//i,
  /^rollup$/i,
  /^rollup-/i,
  /^webpack$/i,
  /^webpack-/i,
  /^parcel$/i,
  /^esbuild$/i,
  /^tsup$/i,
  /^ts-node$/i,
  /^ts-node-/i,
  /^ts-jest$/i,
  /^jest$/i,
  /^jest-/i,
  /^vitest$/i,
  /^vite$/i,
  /^swc$/i,
  /^@swc\//i,
  /^nodemon$/i,
  /^rimraf$/i,
  /^pm2$/i,
  /^turbo$/i,
  /^nx$/i,
  /^postcss$/i,
  /^postcss-/i,
];

const SOURCE_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".cts",
  ".mts",
]);

const CRITICAL_REBUILD_PATTERNS = [
  /(?:^|\/)package\.json$/i,
  /(?:^|\/)tsconfig\.[^/]*$/i,
  /(?:^|\/)tsconfig\.json$/i,
  /(?:^|\/)\.eslintrc(?:\.[^/]+)?$/i,
  /(?:^|\/)eslint\.config\.[^/]+$/i,
  /(?:^|\/)tailwind\.config\.[^/]+$/i,
  /(?:^|\/)postcss\.config\.[^/]+$/i,
  /(?:^|\/)vitest\.config\.[^/]+$/i,
  /(?:^|\/)jest\.config\.[^/]+$/i,
];

const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/build/**",
  "**/dist/**",
];

type FileAnalysis = {
  filePath: string;
  pkgName: string | null;
  hash: string | null;
  internalReferenceCounts: Record<string, number>;
  internalDependencies: string[];
  externalReferenceCounts: Record<string, number>;
};

type AggregatedGraphData = {
  edges: EdgeMap;
  referenceCount: Record<string, number>;
  externalReferenceCount: Record<string, Record<string, number>>;
  dependencyOrigins: Map<string, Map<string, Set<string>>>;
};

function isSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SOURCE_FILE_EXTENSIONS.has(ext);
}

function requiresFullRebuildForPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return CRITICAL_REBUILD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function assembleReportPackages(
  context: ReportAssemblyContext,
  {
    edges,
    cyclicEdges,
    referenceCount,
    externalReferenceCount,
    dependencyOrigins,
  }: {
    edges: EdgeMap;
    cyclicEdges?: Set<string>;
    referenceCount: Record<string, number>;
    externalReferenceCount: Record<string, Record<string, number>>;
    dependencyOrigins: Map<string, Map<string, Set<string>>>;
  },
): ReportPackage[] {
  const activeCyclicEdges = cyclicEdges ?? new Set<string>();

  return context.pkgInfoList.map((pkgInfo) => {
    const allDeps = Array.from(edges.get(pkgInfo.name) ?? []);
    const hasTsconfig = Boolean(pkgInfo.hasTsconfig);
    const hasTailwindConfig = Boolean(pkgInfo.hasTailwindConfig);
    const hasAutoprefixer = Boolean(pkgInfo.hasAutoprefixer);
    const hasEslintConfig = Boolean(pkgInfo.hasEslintConfig);
    const hasChildPackages = Boolean(pkgInfo.hasChildPackages);

    const resolvedDir = path.resolve(pkgInfo.dir);
    const containerPrefix = resolvedDir.endsWith(path.sep)
      ? resolvedDir
      : `${resolvedDir}${path.sep}`;

    const deps = allDeps.filter((dep) => {
      const depDir = context.pkgDirByName.get(dep);
      if (!depDir) return true;
      const depResolved = depDir.endsWith(path.sep)
        ? depDir
        : `${depDir}${path.sep}`;
      return !depResolved.startsWith(containerPrefix);
    });

    const directCyclicDeps = deps.filter((dep) =>
      activeCyclicEdges.has(`${pkgInfo.name}->${dep}`),
    );

    const declaredProdDeps =
      pkgInfo.declaredProdDeps && pkgInfo.declaredProdDeps.length > 0
        ? pkgInfo.declaredProdDeps
        : [];
    const declaredDevDeps =
      pkgInfo.declaredDevDeps && pkgInfo.declaredDevDeps.length > 0
        ? pkgInfo.declaredDevDeps
        : [];
    const fallbackDeclared =
      declaredProdDeps.length === 0 && declaredDevDeps.length === 0
        ? pkgInfo.declaredDeps ?? []
        : [];

    const declaredSet = new Set([
      ...declaredProdDeps,
      ...declaredDevDeps,
      ...fallbackDeclared,
    ]);

    const declaredDeps = deps.filter((dep) => declaredSet.has(dep));
    const undeclaredDeps = deps.filter((dep) => !declaredSet.has(dep));

    const dependencyOriginsForPkg =
      dependencyOrigins.get(pkgInfo.name) ??
      new Map<string, Set<string>>();

    const dependencyDetails = deps.map((dep) => {
      const originFiles = dependencyOriginsForPkg.get(dep);
      const files = originFiles
        ? Array.from(originFiles).map((file) => {
            const relativeToPkg = path.relative(resolvedDir, file);
            const relative =
              relativeToPkg && !relativeToPkg.startsWith("..")
                ? relativeToPkg
                : path.relative(context.resolvedRoot, file);
            return relative.replace(/\\/g, "/");
          })
        : [];
      const uniqueFiles = Array.from(new Set(files)).sort();
      return {
        name: dep,
        files: uniqueFiles,
        fileCount: uniqueFiles.length,
      };
    });

    const externalUsage = externalReferenceCount[pkgInfo.name] || {};
    const toolingDepSet = new Set(
      (pkgInfo.toolingDeps ?? []).map((dep) => normalizeImportSpecifier(dep)),
    );

    const declaredExternalProdNames = new Set<string>();
    for (const declared of declaredProdDeps) {
      const normalized = normalizeImportSpecifier(declared);
      if (!context.workspaceNames.has(normalized)) {
        declaredExternalProdNames.add(normalized);
      }
    }

    const declaredExternalDevNames = new Set<string>();
    for (const declared of declaredDevDeps) {
      const normalized = normalizeImportSpecifier(declared);
      if (!context.workspaceNames.has(normalized)) {
        declaredExternalDevNames.add(normalized);
      }
    }

    if (fallbackDeclared.length > 0) {
      for (const declared of fallbackDeclared) {
        const normalized = normalizeImportSpecifier(declared);
        if (!context.workspaceNames.has(normalized)) {
          declaredExternalProdNames.add(normalized);
        }
      }
    }

    const declaredExternalNames = new Set<string>([
      ...Array.from(declaredExternalProdNames),
      ...Array.from(declaredExternalDevNames),
    ]);
    for (const declared of declaredSet) {
      const normalized = normalizeImportSpecifier(declared);
      if (!context.workspaceNames.has(normalized)) {
        declaredExternalNames.add(normalized);
      }
    }

    const externalDependencies = Array.from(
      new Set([
        ...Array.from(declaredExternalNames),
        ...Object.keys(externalUsage),
      ]),
    ).map((name) => {
      const usageCount = externalUsage[name] ?? 0;
      const declaredInDependencies = declaredExternalProdNames.has(name);
      const declaredInDevDependencies = declaredExternalDevNames.has(name);
      const isLikelyTypePackage = TYPE_PACKAGE_PATTERNS.some((pattern) =>
        pattern.test(name),
      );
      const nameLower = name.toLowerCase();
      const isEslintRelated =
        nameLower === "eslint" ||
        nameLower.startsWith("eslint-") ||
        nameLower.startsWith("@eslint/") ||
        nameLower.startsWith("@typescript-eslint/") ||
        nameLower.includes("eslint-plugin") ||
        nameLower.includes("eslint-config") ||
        nameLower.includes("eslint-parser") ||
        nameLower.includes("eslint-import");
      const isScriptUsed = toolingDepSet.has(name);
      const matchesKnownTooling = KNOWN_TOOLING_PATTERNS.some((pattern) =>
        pattern.test(name),
      );
      const declaredDevOnly =
        declaredInDevDependencies && !declaredInDependencies;
      const isToolingOnly =
        (name === "typescript" && hasTsconfig) ||
        (name === "tailwindcss" && hasTailwindConfig) ||
        (name === "autoprefixer" && hasAutoprefixer) ||
        (hasEslintConfig && isEslintRelated) ||
        isScriptUsed ||
        (matchesKnownTooling && (declaredDevOnly || isScriptUsed));
      const isDeclared =
        declaredInDependencies || declaredInDevDependencies;
      const isUsed = usageCount > 0 || isToolingOnly;
      return {
        name,
        isDeclared,
        isUsed,
        usageCount,
        declaredInDependencies,
        declaredInDevDependencies,
        isLikelyTypePackage,
        isToolingOnly,
      };
    });

    const filteredExternalDependencies = hasChildPackages
      ? externalDependencies.filter((dep) => dep.isUsed || dep.isToolingOnly)
      : externalDependencies;

    const undeclaredExternalDeps = filteredExternalDependencies
      .filter((dep) => dep.isUsed && !dep.isDeclared)
      .map((dep) => dep.name);
    const unusedExternalDeps = filteredExternalDependencies
      .filter(
        (dep) =>
          dep.isDeclared &&
          !dep.isUsed &&
          !dep.isLikelyTypePackage &&
          !dep.isToolingOnly,
      )
      .map((dep) => dep.name);

    const relativeDirRaw = path.relative(context.resolvedRoot, pkgInfo.dir);
    const relativeDir = relativeDirRaw === "" ? "." : relativeDirRaw;

    return {
      name: pkgInfo.name,
      version: pkgInfo.version,
      description: pkgInfo.description,
      fileCount: pkgInfo.fileCount ?? 0,
      relativeDir,
      isRoot: path.resolve(pkgInfo.dir) === context.resolvedRoot,
      hasChildPackages,
      hasTailwindConfig,
      hasTsconfig,
      hasAutoprefixer,
      hasEslintConfig,
      dependencies: deps,
      declaredDeps,
      undeclaredDeps,
      references: referenceCount[pkgInfo.name] || 0,
      cyclicDeps: directCyclicDeps,
      dependencyDetails,
      externalDependencies: filteredExternalDependencies,
      undeclaredExternalDeps,
      unusedExternalDeps,
      toolingDeps: pkgInfo.toolingDeps ?? [],
    };
  });
}

function composeDependencyReport(
  context: ReportAssemblyContext,
  data: {
    edges: EdgeMap;
    cyclicEdges?: Set<string>;
    referenceCount: Record<string, number>;
    externalReferenceCount: Record<string, Record<string, number>>;
    dependencyOrigins: Map<string, Map<string, Set<string>>>;
  },
): DependencyReport {
  return {
    rootDir: context.resolvedRoot,
    packages: assembleReportPackages(context, data),
  };
}

// Parse project files to build the directional import graph and reference counts.
export async function analyzeImportGraph(
  rootDir: string,
  pkgInfoList: PkgInfo[],
  exclude: string[],
  aliasResolvers: TsconfigAliasResolver[] = [],
  callbacks: AnalysisCallbacks = {},
): Promise<{
  edges: EdgeMap;
  cyclicEdges: Set<string>;
  referenceCount: Record<string, number>;
  externalReferenceCount: Record<string, Record<string, number>>;
  dependencyOrigins: Map<string, Map<string, Set<string>>>;
}> {
  const onProgress = callbacks.onProgress;
  const pkgDirMap = buildPackageDirectoryMap(pkgInfoList);
  const pkgNames = new Set(pkgInfoList.map((p) => p.name));

  onProgress?.("Searching for source files...", 10);
  const files = await collectSourceFiles(rootDir, exclude);
  const total = files.length;
  onProgress?.(`Found ${total} source files`, 12);

  const aggregated: AggregatedGraphData = {
    edges: new Map(),
    referenceCount: {},
    externalReferenceCount: {},
    dependencyOrigins: new Map(),
  };

  for (let i = 0; i < total; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);
    const truncated =
      fileName.length > 40 ? `...${fileName.slice(-40)}` : fileName;
    const progress = 12 + ((i + 1) / total) * 65;
    const message = `Analyzing ${i + 1}/${total}: ${truncated}`;

    onProgress?.(message, progress);
    if (i % 20 === 0) await new Promise((resolve) => setImmediate(resolve));

    const analysis = await analyzeSourceFile(
      filePath,
      pkgDirMap,
      pkgNames,
      aliasResolvers,
    );

    if (analysis.pkgName) {
      applyAnalysisToAggregated(analysis, aggregated);
    }

    callbacks.onStateChange?.({
      filePath,
      filesProcessed: i + 1,
      totalFiles: total,
      message,
      progress,
      edges: aggregated.edges,
      referenceCount: aggregated.referenceCount,
      externalReferenceCount: aggregated.externalReferenceCount,
      dependencyOrigins: aggregated.dependencyOrigins,
    });
  }

  onProgress?.(`Finished analyzing ${total} files`, 80);
  const cyclicEdges = identifyCyclicEdges(aggregated.edges, onProgress);
  return {
    edges: aggregated.edges,
    cyclicEdges,
    referenceCount: aggregated.referenceCount,
    externalReferenceCount: aggregated.externalReferenceCount,
    dependencyOrigins: aggregated.dependencyOrigins,
  };
}

type IncrementalBuildOptions = {
  changedFiles?: string[];
  forceFullRebuild?: boolean;
  onProgress?: ProgressCallback;
  onSnapshot?: (event: GenerateReportSnapshotEvent) => void;
};

type BuilderInitOptions = {
  rootDir: string;
  exclude?: string[];
};

export class IncrementalDependencyReportBuilder {
  private readonly rootDir: string;
  private readonly exclude: string[];
  private resolvedRoot: string;
  private pkgInfoList: PkgInfo[] = [];
  private assemblyContext: ReportAssemblyContext | null = null;
  private aliasResolvers: TsconfigAliasResolver[] = [];
  private fileAnalyses = new Map<string, FileAnalysis>();
  private pkgDirMap: Map<string, string> = new Map();
  private pkgDirByName: Map<string, string> = new Map();
  private workspaceNames: Set<string> = new Set();
  private initialized = false;
  private lastReport: DependencyReport | null = null;

  constructor({ rootDir, exclude }: BuilderInitOptions) {
    this.rootDir = rootDir;
    this.exclude = exclude ?? DEFAULT_EXCLUDE_PATTERNS;
    this.resolvedRoot = path.resolve(this.rootDir);
  }

  getLastReport(): DependencyReport | null {
    return this.lastReport;
  }

  async buildReport(options: IncrementalBuildOptions = {}): Promise<DependencyReport> {
    const {
      changedFiles = [],
      forceFullRebuild = false,
      onProgress,
      onSnapshot,
    } = options;

    if (!this.initialized || forceFullRebuild) {
      await this.performFullRebuild(onProgress, onSnapshot);
    } else {
      const normalizedChanges = this.normalizeChangedFiles(changedFiles);
      if (normalizedChanges.length > 0) {
        const applied = await this.applyChanges(normalizedChanges, onProgress);
        if (!applied) {
          onProgress?.("No relevant changes detected.");
          if (this.lastReport) {
            onSnapshot?.({
              message: "Report ready",
              progress: 100,
              report: this.lastReport,
            });
            return this.lastReport;
          }
        }
      } else if (!this.lastReport) {
        await this.performFullRebuild(onProgress, onSnapshot);
      }
    }

    onProgress?.("Preparing report data...", 90);
    const report = this.composeCurrentReport(onProgress);
    onSnapshot?.({ message: "Report ready", progress: 100, report });
    return report;
  }

  private normalizeChangedFiles(paths: string[]): string[] {
    if (!paths.length) return [];
    const resolved = new Set<string>();
    for (const raw of paths) {
      if (!raw) continue;
      const absolute = path.isAbsolute(raw)
        ? raw
        : path.resolve(this.resolvedRoot, raw);
      resolved.add(absolute);
    }
    return Array.from(resolved);
  }

  private async performFullRebuild(
    onProgress?: ProgressCallback,
    onSnapshot?: (event: GenerateReportSnapshotEvent) => void,
  ): Promise<void> {
    this.resolvedRoot = path.resolve(this.rootDir);

    onProgress?.("Detecting packages...", 0);
    const pkgs = await discoverPackages(this.resolvedRoot, this.exclude);
    onProgress?.(`Found ${pkgs.length} packages`, 8);
    if (pkgs.length === 0) {
      throw new Error(`No packages found in ${this.resolvedRoot}`);
    }

    this.pkgInfoList = pkgs;
    this.pkgDirMap = buildPackageDirectoryMap(pkgs);
    this.pkgDirByName = new Map(
      pkgs.map((pkg) => [pkg.name, path.resolve(pkg.dir)]),
    );
    this.workspaceNames = new Set(this.pkgDirByName.keys());
    this.assemblyContext = {
      pkgInfoList: pkgs,
      pkgDirByName: this.pkgDirByName,
      workspaceNames: this.workspaceNames,
      resolvedRoot: this.resolvedRoot,
    } satisfies ReportAssemblyContext;

    const aggregated: AggregatedGraphData = {
      edges: new Map(),
      referenceCount: {},
      externalReferenceCount: {},
      dependencyOrigins: new Map(),
    };

    const SNAPSHOT_THROTTLE_MS = 250;
    let lastSnapshotAt = 0;
    const dispatchSnapshot = (
      message: string,
      progress: number | undefined,
      builder: () => DependencyReport,
      force = false,
    ) => {
      if (!onSnapshot) return;
      const now = Date.now();
      if (!force && now - lastSnapshotAt < SNAPSHOT_THROTTLE_MS) return;
      const report = builder();
      onSnapshot({
        message,
        progress,
        report,
      });
      lastSnapshotAt = now;
    };

    dispatchSnapshot(
      `Packages discovered (${pkgs.length})`,
      8,
      () =>
        composeDependencyReport(this.getAssemblyContext(), {
          edges: aggregated.edges,
          referenceCount: aggregated.referenceCount,
          externalReferenceCount: aggregated.externalReferenceCount,
          dependencyOrigins: aggregated.dependencyOrigins,
          cyclicEdges: new Set(),
        }),
      true,
    );

    onProgress?.("Analyzing imports...", 20);
    this.aliasResolvers = await loadTsconfigAliasResolvers(
      this.resolvedRoot,
      this.exclude,
    );

    onProgress?.("Searching for source files...", 22);
    const files = await collectSourceFiles(this.resolvedRoot, this.exclude);
    const total = files.length;
    onProgress?.(`Found ${total} source files`, 25);

    this.fileAnalyses = new Map();

    for (let i = 0; i < total; i++) {
      const filePath = files[i];
      const fileName = path.basename(filePath);
      const truncated =
        fileName.length > 40 ? `...${fileName.slice(-40)}` : fileName;
      const progress = 25 + ((i + 1) / Math.max(total, 1)) * 55;
      const message = `Analyzing ${i + 1}/${total}: ${truncated}`;

      onProgress?.(message, progress);
      if (i % 20 === 0) await new Promise((resolve) => setImmediate(resolve));

      const analysis = await analyzeSourceFile(
        filePath,
        this.pkgDirMap,
        this.workspaceNames,
        this.aliasResolvers,
      );

      if (analysis.pkgName) {
        applyAnalysisToAggregated(analysis, aggregated);
        this.fileAnalyses.set(filePath, analysis);
      }

      dispatchSnapshot(message, progress, () =>
        composeDependencyReport(this.getAssemblyContext(), {
          edges: aggregated.edges,
          referenceCount: aggregated.referenceCount,
          externalReferenceCount: aggregated.externalReferenceCount,
          dependencyOrigins: aggregated.dependencyOrigins,
        }),
      );
    }

    onProgress?.(`Finished analyzing ${total} files`, 80);
    const cyclicEdges = identifyCyclicEdges(aggregated.edges, onProgress);

    this.lastReport = composeDependencyReport(this.getAssemblyContext(), {
      edges: aggregated.edges,
      cyclicEdges,
      referenceCount: aggregated.referenceCount,
      externalReferenceCount: aggregated.externalReferenceCount,
      dependencyOrigins: aggregated.dependencyOrigins,
    });

    dispatchSnapshot("Report ready", 100, () => this.lastReport!, true);
    this.initialized = true;
  }

  private composeCurrentReport(onProgress?: ProgressCallback): DependencyReport {
    const aggregated = buildAggregatedGraphData(this.fileAnalyses.values());
    const cyclicEdges = identifyCyclicEdges(aggregated.edges, onProgress);
    const report = composeDependencyReport(this.getAssemblyContext(), {
      edges: aggregated.edges,
      cyclicEdges,
      referenceCount: aggregated.referenceCount,
      externalReferenceCount: aggregated.externalReferenceCount,
      dependencyOrigins: aggregated.dependencyOrigins,
    });
    this.lastReport = report;
    return report;
  }

  private async applyChanges(
    paths: string[],
    onProgress?: ProgressCallback,
  ): Promise<boolean> {
    if (paths.length === 0) return false;

    let requiresFull = false;
    const updates: Array<{ path: string; exists: boolean }>
      = [];

    for (const absPath of paths) {
      if (requiresFullRebuildForPath(absPath)) {
        requiresFull = true;
        break;
      }

      if (!isSourceFile(absPath)) continue;

      let exists = false;
      try {
        const stats = await stat(absPath);
        exists = stats.isFile();
      } catch {
        exists = false;
      }
      updates.push({ path: absPath, exists });
    }

    if (requiresFull) {
      await this.performFullRebuild(onProgress);
      return true;
    }

    if (updates.length === 0) return false;

    let changed = false;
    for (const update of updates) {
      if (update.exists) {
        const analysis = await analyzeSourceFile(
          update.path,
          this.pkgDirMap,
          this.workspaceNames,
          this.aliasResolvers,
        );
        if (analysis.pkgName) {
          const previous = this.fileAnalyses.get(update.path);
          if (previous?.hash === analysis.hash) {
            continue;
          }
          this.fileAnalyses.set(update.path, analysis);
          changed = true;
        } else if (this.fileAnalyses.delete(update.path)) {
          changed = true;
        }
      } else if (this.fileAnalyses.delete(update.path)) {
        changed = true;
      }
    }

    return changed;
  }

  private getAssemblyContext(): ReportAssemblyContext {
    if (!this.assemblyContext) {
      throw new Error("Incremental builder not initialised");
    }
    return this.assemblyContext;
  }
}

// High-level orchestrator: discover packages, analyze imports, and assemble the
// final data model consumed by renderers.
export async function generateDependencyReport({
  rootDir = ".",
  exclude = DEFAULT_EXCLUDE_PATTERNS,
  onProgress,
  onSnapshot,
}: GenerateReportOptions & {
  onProgress?: (msg: string, progress?: number) => void;
} = {}): Promise<DependencyReport> {
  const builder = new IncrementalDependencyReportBuilder({
    rootDir,
    exclude,
  });

  return builder.buildReport({
    forceFullRebuild: true,
    onProgress,
    onSnapshot,
  });
}
