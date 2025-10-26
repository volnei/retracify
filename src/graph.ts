import path from "path";
import { builtinModules } from "module";
import { Project, SyntaxKind, Node } from "ts-morph";
import type { ImportEqualsDeclaration } from "ts-morph";
import type { EdgeMap, GenerateReportOptions, PkgInfo } from "./types.js";
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

// Parse project files to build the directional import graph and reference counts.
export async function analyzeImportGraph(
  rootDir: string,
  pkgInfoList: PkgInfo[],
  exclude: string[],
  aliasResolversOrOnProgress?: TsconfigAliasResolver[] | ProgressCallback,
  onProgressMaybe?: ProgressCallback,
): Promise<{
  edges: EdgeMap;
  cyclicEdges: Set<string>;
  referenceCount: Record<string, number>;
  externalReferenceCount: Record<string, Record<string, number>>;
}> {
  let aliasResolvers: TsconfigAliasResolver[] = [];
  let onProgress: ProgressCallback | undefined;

  if (Array.isArray(aliasResolversOrOnProgress)) {
    aliasResolvers = aliasResolversOrOnProgress;
    onProgress = onProgressMaybe;
  } else if (typeof aliasResolversOrOnProgress === "function") {
    onProgress = aliasResolversOrOnProgress;
  }

  if (!aliasResolvers) aliasResolvers = [];

  const pkgDirMap = buildPackageDirectoryMap(pkgInfoList);
  const pkgNames = new Set(pkgInfoList.map((p) => p.name));

  onProgress?.("Searching for source files...", 10);
  const files = await collectSourceFiles(rootDir, exclude);
  const total = files.length;
  onProgress?.(`Found ${total} source files`, 12);

  const resolveTargetPackage = (spec: string): string | null => {
    if (!spec) return null;
    const segments = spec.split("/");

    // Attempt to resolve the longest matching workspace name (handles scoped subpaths).
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

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const edges: EdgeMap = new Map();
  const referenceCount: Record<string, number> = {};
  const externalReferenceCount: Record<string, Record<string, number>> = {};

  for (let i = 0; i < total; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);
    const truncated =
      fileName.length > 40 ? `...${fileName.slice(-40)}` : fileName;
    const progress = 12 + ((i + 1) / total) * 65;

    onProgress?.(`Analyzing ${i + 1}/${total}: ${truncated}`, progress);
    if (i % 20 === 0) await new Promise((r) => setImmediate(r));

    const sourceFile = project.addSourceFileAtPath(filePath);
    const fromPkg = resolvePackageForFile(filePath, pkgDirMap);
    if (!fromPkg) continue;

    const processImport = (spec: string) => {
      if (!spec) return;
      if (
        spec.startsWith(".") ||
        spec.startsWith("..") ||
        spec.startsWith("/") ||
        spec.startsWith("file:")
      ) {
        return;
      }

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
          if (!edges.has(fromPkg)) edges.set(fromPkg, new Set());
          edges.get(fromPkg)!.add(aliasPkg);
          referenceCount[aliasPkg] = (referenceCount[aliasPkg] || 0) + 1;
          return;
        }
      }

      const target = resolveTargetPackage(spec);
      if (target && target !== fromPkg) {
        if (!edges.has(fromPkg)) edges.set(fromPkg, new Set());
        edges.get(fromPkg)!.add(target);
        referenceCount[target] = (referenceCount[target] || 0) + 1;
        return;
      }

      const externalName = normalizeImportSpecifier(spec);
      if (!externalName) return;
      if (!externalReferenceCount[fromPkg]) {
        externalReferenceCount[fromPkg] = {};
      }
      externalReferenceCount[fromPkg][externalName] =
        (externalReferenceCount[fromPkg][externalName] || 0) + 1;
    };

    const extractSpecifierFromExpression = (expr: Node | undefined): string | null => {
      if (!expr) return null;
      if (Node.isStringLiteral(expr)) return expr.getLiteralValue();
      if (Node.isNoSubstitutionTemplateLiteral(expr))
        return expr.getLiteralText();
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

    sourceFile
      .getImportDeclarations()
      .forEach((imp) => processImport(imp.getModuleSpecifierValue()));

    sourceFile.getExportDeclarations().forEach((exp) => {
      const specifier = exp.getModuleSpecifierValue();
      if (specifier) processImport(specifier);
    });

    type ImportEqualsProvider = {
      getImportEqualsDeclarations(): ImportEqualsDeclaration[];
    };
    const importEqualsProvider =
      sourceFile as Partial<ImportEqualsProvider>;
    const importEqualsDeclarations =
      typeof importEqualsProvider.getImportEqualsDeclarations === "function"
        ? importEqualsProvider.getImportEqualsDeclarations()
        : [];

    importEqualsDeclarations.forEach((decl) => {
      const moduleRef = decl.getModuleReference();
      if (!moduleRef) return;
      if (!Node.isExternalModuleReference(moduleRef)) return;
      const specifier = extractSpecifierFromExpression(
        moduleRef.getExpression(),
      );
      if (specifier) processImport(specifier);
    });

    sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .forEach((call) => {
        const expr = call.getExpression();
        const args = call.getArguments();
        if (args.length === 0) return;
        const spec = extractSpecifierFromExpression(args[0]);
        if (!spec) return;

        if (expr.getKind() === SyntaxKind.ImportKeyword) {
          processImport(spec);
          return;
        }

        if (Node.isIdentifier(expr)) {
          if (expr.getText() === "require") {
            processImport(spec);
          }
          return;
        }

        if (Node.isPropertyAccessExpression(expr)) {
          const baseName = expr.getExpression().getText();
          const propertyName = expr.getName();
          if (propertyAccessAllowList.has(`${baseName}.${propertyName}`)) {
            processImport(spec);
          }
          return;
        }
      });
  }

  onProgress?.(`Finished analyzing ${total} files`, 80);
  const cyclicEdges = identifyCyclicEdges(edges, onProgress);
  return { edges, cyclicEdges, referenceCount, externalReferenceCount };
}

// High-level orchestrator: discover packages, analyze imports, and assemble the
// final data model consumed by renderers.
export async function generateDependencyReport({
  rootDir = ".",
  exclude = ["**/node_modules/**", "**/build/**", "**/dist/**"],
  onProgress,
}: GenerateReportOptions & {
  onProgress?: (msg: string, progress?: number) => void;
} = {}): Promise<{
  rootDir: string;
  packages: {
    name: string;
    version?: string;
    description?: string;
    relativeDir?: string;
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
    isRoot?: boolean;
    toolingDeps: string[];
  }[];
}> {
  const resolvedRoot = path.resolve(rootDir);

  onProgress?.("Detecting packages...", 0);
  const pkgs = await discoverPackages(resolvedRoot, exclude);
  onProgress?.(`Found ${pkgs.length} packages`, 8);
  if (!pkgs.length) throw new Error(`No packages found in ${resolvedRoot}`);

  onProgress?.("Analyzing imports...", 20);
  const aliasResolvers = await loadTsconfigAliasResolvers(
    resolvedRoot,
    exclude,
  );
  const { edges, cyclicEdges, referenceCount, externalReferenceCount } =
    await analyzeImportGraph(
      resolvedRoot,
      pkgs,
      exclude,
      aliasResolvers,
      onProgress,
    );

  onProgress?.("Preparing report data...", 90);
  const pkgDirByName = new Map(
    pkgs.map((pkg) => [pkg.name, path.resolve(pkg.dir)]),
  );
  const workspaceNames = new Set(pkgDirByName.keys());

  const reportData = {
    rootDir: resolvedRoot,
    packages: pkgs.map((p) => {
      const allDeps = [...(edges.get(p.name) || [])];
      const hasTsconfig = Boolean(p.hasTsconfig);
      const hasTailwindConfig = Boolean(p.hasTailwindConfig);
      const hasAutoprefixer = Boolean(p.hasAutoprefixer);
      const hasEslintConfig = Boolean(p.hasEslintConfig);
      const hasChildPackages = Boolean(p.hasChildPackages);

      const resolvedDir = path.resolve(p.dir);
      const containerPrefix = resolvedDir.endsWith(path.sep)
        ? resolvedDir
        : `${resolvedDir}${path.sep}`;

      // Guard against packages inheriting dependencies from nested workspaces.
      const deps = allDeps.filter((dep) => {
        const depDir = pkgDirByName.get(dep);
        if (!depDir) return true;
        const depResolved = depDir.endsWith(path.sep)
          ? depDir
          : `${depDir}${path.sep}`;
        return !depResolved.startsWith(containerPrefix);
      });

      const directCyclicDeps = deps.filter((dep) =>
        cyclicEdges.has(`${p.name}->${dep}`),
      );

      const declaredProdDeps =
        p.declaredProdDeps && p.declaredProdDeps.length > 0
          ? p.declaredProdDeps
          : [];
      const declaredDevDeps =
        p.declaredDevDeps && p.declaredDevDeps.length > 0
          ? p.declaredDevDeps
          : [];
      const fallbackDeclared =
        declaredProdDeps.length === 0 && declaredDevDeps.length === 0
          ? p.declaredDeps ?? []
          : [];
      const declaredSet = new Set([
        ...declaredProdDeps,
        ...declaredDevDeps,
        ...fallbackDeclared,
      ]);
      const declaredDeps = deps.filter((d) => declaredSet.has(d));
      const undeclaredDeps = deps.filter((d) => !declaredSet.has(d));

      const externalUsage = externalReferenceCount[p.name] || {};
      const toolingDepSet = new Set(
        (p.toolingDeps ?? []).map((dep) =>
          normalizeImportSpecifier(dep),
        ),
      );
      const declaredExternalProdNames = new Set<string>();
      for (const declared of declaredProdDeps) {
        const normalized = normalizeImportSpecifier(declared);
        if (!workspaceNames.has(normalized)) {
          declaredExternalProdNames.add(normalized);
        }
      }
      const declaredExternalDevNames = new Set<string>();
      for (const declared of declaredDevDeps) {
        const normalized = normalizeImportSpecifier(declared);
        if (!workspaceNames.has(normalized)) {
          declaredExternalDevNames.add(normalized);
        }
      }
      if (fallbackDeclared.length > 0) {
        for (const declared of fallbackDeclared) {
          const normalized = normalizeImportSpecifier(declared);
          if (!workspaceNames.has(normalized)) {
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
        if (!workspaceNames.has(normalized)) {
          declaredExternalNames.add(normalized);
        }
      }

      const typePackagePatterns = [/^@types\//i, /-types$/i, /^types[-/]/i];

      const externalDependencies = Array.from(
        new Set([
          ...Array.from(declaredExternalNames),
          ...Object.keys(externalUsage),
        ]),
      ).map((name) => {
        const usageCount = externalUsage[name] ?? 0;
        const declaredInDependencies = declaredExternalProdNames.has(name);
        const declaredInDevDependencies = declaredExternalDevNames.has(name);
        const isLikelyTypePackage = typePackagePatterns.some((pattern) =>
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
        const isToolingOnly =
          (name === "typescript" && hasTsconfig) ||
          (name === "tailwindcss" && hasTailwindConfig) ||
          (name === "autoprefixer" && hasAutoprefixer) ||
          (hasEslintConfig && isEslintRelated) ||
          isScriptUsed;
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
        ? externalDependencies.filter(
            (dep) => dep.isUsed || dep.isToolingOnly,
          )
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

      const isRoot = path.resolve(p.dir) === resolvedRoot;

      return {
        name: p.name,
        version: p.version,
        description: p.description,
        fileCount: p.fileCount ?? 0,
        relativeDir: path.relative(resolvedRoot, p.dir),
        isRoot,
        hasChildPackages,
        hasTailwindConfig,
        hasTsconfig,
        hasAutoprefixer,
        hasEslintConfig,
        dependencies: deps,
        declaredDeps,
        undeclaredDeps,
        references: referenceCount[p.name] || 0,
        cyclicDeps: directCyclicDeps,
        externalDependencies: filteredExternalDependencies,
        undeclaredExternalDeps,
        unusedExternalDeps,
        toolingDeps: p.toolingDeps ?? [],
      };
    }),
  };

  return reportData;
}
