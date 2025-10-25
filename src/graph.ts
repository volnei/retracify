import path from "path";
import { Project, SyntaxKind } from "ts-morph";
import type { EdgeMap, GenerateGraphOptions, PkgInfo } from "./types.js";
import {
  detectPackages,
  findSourceFiles,
  normalizePackageName,
} from "./utils.js";

export function buildPkgDirMap(pkgList: PkgInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkg of pkgList) map.set(pkg.dir, pkg.name);
  return map;
}

export function findPkgNameByFile(
  filePath: string,
  pkgDirMap: Map<string, string>,
): string | null {
  const absoluteFilePath = path.resolve(filePath);
  let matchedDir: string | null = null;
  let matchedPkg: string | null = null;

  for (const [dir, pkgName] of pkgDirMap.entries()) {
    const absoluteDir = path.resolve(dir);
    const relative = path.relative(absoluteDir, absoluteFilePath);
    const isWithinDir =
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

    if (!isWithinDir) continue;
    if (!matchedDir || absoluteDir.length > matchedDir.length) {
      matchedDir = absoluteDir;
      matchedPkg = pkgName;
    }
  }

  return matchedPkg;
}

export function detectCycles(
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

export async function scanImports(
  rootDir: string,
  pkgInfoList: PkgInfo[],
  exclude: string[],
  onProgress?: (msg: string, progress?: number) => void,
): Promise<{
  edges: EdgeMap;
  cyclicEdges: Set<string>;
  referenceCount: Record<string, number>;
}> {
  const pkgDirMap = buildPkgDirMap(pkgInfoList);
  const pkgNames = new Set(pkgInfoList.map((p) => p.name));

  onProgress?.("Searching for source files...", 10);
  const files = await findSourceFiles(rootDir, exclude);
  const total = files.length;
  onProgress?.(`Found ${total} source files`, 12);

  const resolveTargetPackage = (spec: string): string | null => {
    if (!spec) return null;
    if (pkgNames.has(spec)) return spec;
    const normalized = normalizePackageName(spec);
    return pkgNames.has(normalized) ? normalized : null;
  };

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const edges: EdgeMap = new Map();
  const referenceCount: Record<string, number> = {};

  for (let i = 0; i < total; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);
    const truncated =
      fileName.length > 40 ? `...${fileName.slice(-40)}` : fileName;
    const progress = 12 + ((i + 1) / total) * 65;

    onProgress?.(`Analyzing ${i + 1}/${total}: ${truncated}`, progress);
    if (i % 20 === 0) await new Promise((r) => setImmediate(r));

    const sourceFile = project.addSourceFileAtPath(filePath);
    const fromPkg = findPkgNameByFile(filePath, pkgDirMap);
    if (!fromPkg) continue;

    const processImport = (spec: string) => {
      const target = resolveTargetPackage(spec);
      if (target && target !== fromPkg) {
        if (!edges.has(fromPkg)) edges.set(fromPkg, new Set());
        edges.get(fromPkg)!.add(target);
        referenceCount[target] = (referenceCount[target] || 0) + 1;
      }
    };

    sourceFile
      .getImportDeclarations()
      .forEach((imp) => processImport(imp.getModuleSpecifierValue()));

    sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .forEach((call) => {
        const expr = call.getExpression();
        if (
          expr.getKind() === SyntaxKind.Identifier &&
          expr.getText() === "require"
        ) {
          const args = call.getArguments();
          if (
            args.length === 1 &&
            args[0].getKind() === SyntaxKind.StringLiteral
          ) {
            processImport(args[0].getText().slice(1, -1));
          }
        }
      });

    sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .forEach((call) => {
        const expr = call.getExpression();
        if (expr.getKind() === SyntaxKind.ImportKeyword) {
          const args = call.getArguments();
          if (
            args.length === 1 &&
            args[0].getKind() === SyntaxKind.StringLiteral
          ) {
            processImport(args[0].getText().slice(1, -1));
          }
        }
      });
  }

  onProgress?.(`Finished analyzing ${total} files`, 80);
  const cyclicEdges = detectCycles(edges, onProgress);
  return { edges, cyclicEdges, referenceCount };
}

export async function generateGraph({
  rootDir = ".",
  exclude = ["**/node_modules/**", "**/build/**", "**/dist/**"],
  onProgress,
}: GenerateGraphOptions & {
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
  }[];
}> {
  const resolvedRoot = path.resolve(rootDir);

  onProgress?.("Detecting packages...", 0);
  const pkgs = await detectPackages(resolvedRoot, exclude);
  onProgress?.(`Found ${pkgs.length} packages`, 8);
  if (!pkgs.length) throw new Error(`No packages found in ${resolvedRoot}`);

  onProgress?.("Analyzing imports...", 20);
  const { edges, cyclicEdges, referenceCount } = await scanImports(
    resolvedRoot,
    pkgs,
    exclude,
    onProgress,
  );

  onProgress?.("Preparing report data...", 90);
  const reportData = {
    rootDir: resolvedRoot,
    packages: pkgs.map((p) => {
      const deps = [...(edges.get(p.name) || [])];
      const directCyclicDeps = deps.filter((dep) =>
        cyclicEdges.has(`${p.name}->${dep}`),
      );

      const declaredSet = new Set(p.declaredDeps || []);
      const declaredDeps = deps.filter((d) => declaredSet.has(d));
      const undeclaredDeps = deps.filter((d) => !declaredSet.has(d));

      const isRoot = path.resolve(p.dir) === resolvedRoot;

      return {
        name: p.name,
        version: p.version,
        description: p.description,
        fileCount: p.fileCount ?? 0,
        relativeDir: path.relative(resolvedRoot, p.dir),
        isRoot,
        dependencies: deps,
        declaredDeps,
        undeclaredDeps,
        references: referenceCount[p.name] || 0,
        cyclicDeps: directCyclicDeps,
      };
    }),
  };

  return reportData;
}
