import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PkgInfo, EdgeMap } from "../src/types";

type SyntaxNodeMock = { kind?: number } | undefined;

const mocks = vi.hoisted(() => {
  const fsMock = { writeFile: vi.fn() };
  const collectSourceFilesMock = vi.fn();
  const discoverPackagesMock = vi.fn();
  const renderHtmlReportMock = vi.fn();
  const normalizeImportSpecifierMock = vi.fn((s: string) =>
    s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0],
  );
  const loadTsconfigAliasResolversMock = vi.fn(async () => []);
  const resolvePathAliasImportMock = vi.fn(() => []);
  const importSpecRef = { value: "lib-b" };

  const ProjectMock = vi.fn(function () {
    this.addSourceFileAtPath = vi.fn().mockReturnValue({
      getImportDeclarations: vi.fn(() => [
        { getModuleSpecifierValue: vi.fn(() => importSpecRef.value) },
      ]),
      getExportDeclarations: vi.fn(() => []),
      getImportEqualsDeclarations: vi.fn(() => []),
      getDescendantsOfKind: vi.fn(() => []),
    });
  });

  return {
    fsMock,
    collectSourceFilesMock,
    discoverPackagesMock,
    renderHtmlReportMock,
    normalizeImportSpecifierMock,
    loadTsconfigAliasResolversMock,
    resolvePathAliasImportMock,
    ProjectMock,
    importSpecRef,
  };
});

vi.mock("fs/promises", () => {
  const fsModule = { writeFile: mocks.fsMock.writeFile };
  return { ...fsModule, default: fsModule };
});

vi.mock("ts-morph", () => ({
  Project: mocks.ProjectMock,
  SyntaxKind: {
    CallExpression: 1,
    Identifier: 2,
    StringLiteral: 3,
    ImportKeyword: 4,
    PropertyAccessExpression: 5,
    NoSubstitutionTemplateLiteral: 6,
    ExternalModuleReference: 7,
  },
  Node: {
    isStringLiteral: (node: SyntaxNodeMock) => node?.kind === 3,
    isNoSubstitutionTemplateLiteral: (node: SyntaxNodeMock) => node?.kind === 6,
    isIdentifier: (node: SyntaxNodeMock) => node?.kind === 2,
    isPropertyAccessExpression: () => false,
  },
})); 

vi.mock("../src/utils", () => ({
  discoverPackages: mocks.discoverPackagesMock,
  collectSourceFiles: mocks.collectSourceFilesMock,
  renderHtmlReport: mocks.renderHtmlReportMock,
  normalizeImportSpecifier: mocks.normalizeImportSpecifierMock,
  loadTsconfigAliasResolvers: mocks.loadTsconfigAliasResolversMock,
  resolvePathAliasImport: mocks.resolvePathAliasImportMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importSpecRef.value = "lib-b";
});

describe("graph.ts - Helper Functions", () => {
  test("buildPackageDirectoryMap and resolvePackageForFile work correctly", async () => {
    const { buildPackageDirectoryMap, resolvePackageForFile } = await import("../src/graph");
    const pkgs = [
      { name: "pkg-root", dir: "/root" },
      { name: "pkg-a", dir: "/root/pkg-a" },
      { name: "pkg-b", dir: "/root/libs/pkg-b" },
    ] as PkgInfo[];

    const map = buildPackageDirectoryMap(pkgs);
    expect(map.get("/root")).toBe("pkg-root");
    expect(map.get("/root/pkg-a")).toBe("pkg-a");

    expect(resolvePackageForFile("/root/pkg-a/src/index.ts", map)).toBe("pkg-a");
    expect(resolvePackageForFile("/root/libs/pkg-b/lib/index.ts", map)).toBe("pkg-b");
    expect(resolvePackageForFile("/root/index.ts", map)).toBe("pkg-root");
  });

  test("identifyCyclicEdges flags a simple cycle", async () => {
    const { identifyCyclicEdges } = await import("../src/graph");
    const edges: EdgeMap = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    const result = identifyCyclicEdges(edges);
    expect(result.has("a->b")).toBe(true);
    expect(result.has("b->a")).toBe(true);
  });
});

describe("graph.ts - analyzeImportGraph", () => {
  test("maps static imports and generates edges", async () => {
    mocks.collectSourceFilesMock.mockResolvedValue(["/root/pkg-a/index.ts"]);

    const { analyzeImportGraph } = await import("../src/graph");
    const pkgs = [
      { name: "pkg-a", dir: "/root/pkg-a" },
      { name: "lib-b", dir: "/root/lib-b" },
    ] as PkgInfo[];

    const { edges } = await analyzeImportGraph("/root", pkgs, []);

    expect(mocks.ProjectMock).toHaveBeenCalled();
    expect(edges.get("pkg-a")?.has("lib-b")).toBe(true);
  });

  test("handles scoped workspace packages with nested segments", async () => {
    mocks.importSpecRef.value = "@scope/app/ui/button/dist";
    mocks.collectSourceFilesMock.mockResolvedValue(["/root/app/index.ts"]);

    const { analyzeImportGraph } = await import("../src/graph");
    const pkgs = [
      { name: "@scope/app", dir: "/root/app" },
      { name: "@scope/app/ui/button", dir: "/root/app/ui/button" },
    ] as PkgInfo[];

    const { edges } = await analyzeImportGraph("/root", pkgs, []);

    expect(edges.get("@scope/app")?.has("@scope/app/ui/button")).toBe(true);
    expect(edges.get("@scope/app")?.has("@scope/app")).toBeFalsy();
  });
});

describe("graph.ts - generateDependencyReport", () => {
  test("returns report data with root metadata", async () => {
    mocks.discoverPackagesMock.mockResolvedValue([
      {
        name: "root",
        dir: "/repo",
        version: "1.0.0",
        description: "Root package",
        fileCount: 10,
        declaredDeps: [],
      },
      {
        name: "@scope/a",
        dir: "/repo/packages/a",
        version: "1.0.0",
        description: "",
        fileCount: 3,
        declaredDeps: ["@scope/b", "lodash"],
      },
      {
        name: "@scope/b",
        dir: "/repo/packages/b",
        version: "0.1.0",
        description: "",
        fileCount: 2,
        declaredDeps: [],
      },
    ] as PkgInfo[]);
    mocks.importSpecRef.value = "@scope/b/components";
    mocks.collectSourceFilesMock.mockResolvedValue([
      "/repo/packages/a/src/index.ts",
    ]);

    const { generateDependencyReport } = await import("../src/graph");
    const report = await generateDependencyReport({ rootDir: "/repo" });

    expect(report.rootDir).toBe("/repo");
    expect(report.packages).toHaveLength(3);

    const rootPkg = report.packages[0];
    expect(rootPkg.isRoot).toBe(true);
    expect(rootPkg.relativeDir).toBe("");
    expect(rootPkg.dependencies).toEqual([]);

    const pkgA = report.packages[1];
    expect(pkgA.name).toBe("@scope/a");
    expect(pkgA.isRoot).toBe(false);
    expect(pkgA.declaredDeps).toEqual(["@scope/b"]);
    expect(pkgA.undeclaredDeps).toEqual([]);
    expect(pkgA.externalDependencies).toEqual([
      {
        name: "lodash",
        isDeclared: true,
        isUsed: false,
        usageCount: 0,
        declaredInDependencies: true,
        declaredInDevDependencies: false,
        isLikelyTypePackage: false,
        isToolingOnly: false,
      },
    ]);
    expect(pkgA.unusedExternalDeps).toEqual(["lodash"]);
    expect(pkgA.undeclaredExternalDeps).toEqual([]);
  });

  test("filters nested workspace dependencies from container packages", async () => {
    mocks.discoverPackagesMock.mockResolvedValue([
      {
        name: "@scope/a",
        dir: "/repo/packages/a",
        version: "1.0.0",
        description: "",
        fileCount: 3,
        declaredDeps: [],
      },
      {
        name: "@scope/a/ui",
        dir: "/repo/packages/a/ui",
        version: "1.0.0",
        description: "",
        fileCount: 2,
        declaredDeps: [],
      },
      {
        name: "@scope/util",
        dir: "/repo/packages/util",
        version: "0.2.0",
        description: "",
        fileCount: 2,
        declaredDeps: [],
      },
    ] as PkgInfo[]);

    mocks.importSpecRef.value = "@scope/a/ui/components";
    mocks.collectSourceFilesMock.mockResolvedValue([
      "/repo/packages/a/src/index.ts",
      "/repo/packages/a/src/feature.ts",
    ]);

    const { generateDependencyReport } = await import("../src/graph");
    const report = await generateDependencyReport({ rootDir: "/repo" });

    const pkgA = report.packages.find((pkg) => pkg.name === "@scope/a")!;
    expect(pkgA.dependencies).toEqual([]);
    expect(pkgA.declaredDeps).toEqual([]);
    expect(pkgA.undeclaredDeps).toEqual([]);
    expect(pkgA.externalDependencies).toEqual([]);

    const utilPkg = report.packages.find((pkg) => pkg.name === "@scope/util")!;
    expect(utilPkg.dependencies).toEqual([]);
    expect(utilPkg.isRoot).toBeFalsy();
  });

  test("throws when no packages are detected", async () => {
    mocks.discoverPackagesMock.mockResolvedValue([]);
    const { generateDependencyReport } = await import("../src/graph");
    await expect(generateDependencyReport({ rootDir: "/empty" })).rejects.toThrow(
      "No packages found in /empty",
    );
  });
});
