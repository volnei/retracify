import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PkgInfo, EdgeMap } from "../src/types";

const mocks = vi.hoisted(() => {
  const fsMock = { writeFile: vi.fn() };
  const findSourceFilesMock = vi.fn();
  const detectPackagesMock = vi.fn();
  const createHtmlTemplateMock = vi.fn();
  const normalizePackageNameMock = vi.fn((s: string) => s.split("/")[0]);
  const importSpecRef = { value: "lib-b" };

  const ProjectMock = vi.fn(function () {
    this.addSourceFileAtPath = vi.fn().mockReturnValue({
      getImportDeclarations: vi.fn(() => [
        { getModuleSpecifierValue: vi.fn(() => importSpecRef.value) },
      ]),
      getDescendantsOfKind: vi.fn(() => []),
    });
  });

  return {
    fsMock,
    findSourceFilesMock,
    detectPackagesMock,
    createHtmlTemplateMock,
    normalizePackageNameMock,
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
  },
}));

vi.mock("../src/utils", () => ({
  detectPackages: mocks.detectPackagesMock,
  findSourceFiles: mocks.findSourceFilesMock,
  createHtmlTemplate: mocks.createHtmlTemplateMock,
  normalizePackageName: mocks.normalizePackageNameMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("graph.ts - Helper Functions", () => {
  test("buildPkgDirMap and findPkgNameByFile work correctly", async () => {
    const { buildPkgDirMap, findPkgNameByFile } = await import("../src/graph");
    const pkgs = [
      { name: "pkg-root", dir: "/root" },
      { name: "pkg-a", dir: "/root/pkg-a" },
      { name: "pkg-b", dir: "/root/libs/pkg-b" },
    ] as PkgInfo[];

    const map = buildPkgDirMap(pkgs);
    expect(map.get("/root")).toBe("pkg-root");
    expect(map.get("/root/pkg-a")).toBe("pkg-a");

    expect(findPkgNameByFile("/root/pkg-a/src/index.ts", map)).toBe("pkg-a");
    expect(findPkgNameByFile("/root/libs/pkg-b/lib/index.ts", map)).toBe("pkg-b");
    expect(findPkgNameByFile("/root/index.ts", map)).toBe("pkg-root");
  });

  test("detectCycles identifies a simple cycle", async () => {
    const { detectCycles } = await import("../src/graph");
    const edges: EdgeMap = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    const result = detectCycles(edges);
    expect(result.has("a->b")).toBe(true);
    expect(result.has("b->a")).toBe(true);
  });
});

describe("graph.ts - scanImports", () => {
  test("maps static imports and generates edges", async () => {
    mocks.findSourceFilesMock.mockResolvedValue(["/root/pkg-a/index.ts"]);

    const { scanImports } = await import("../src/graph");
    const pkgs = [
      { name: "pkg-a", dir: "/root/pkg-a" },
      { name: "lib-b", dir: "/root/lib-b" },
    ] as PkgInfo[];

    const { edges } = await scanImports("/root", pkgs, []);

    expect(mocks.ProjectMock).toHaveBeenCalled();
    expect(edges.get("pkg-a")?.has("lib-b")).toBe(true);
  });
});

describe("graph.ts - generateGraph", () => {
  test("writes HTML when packages exist", async () => {
    mocks.detectPackagesMock.mockResolvedValue([
      { name: "pkg-a", dir: "/root/pkg-a" },
    ]);
    mocks.findSourceFilesMock.mockResolvedValue([]);
    mocks.createHtmlTemplateMock.mockReturnValue("<html>ok</html>");

    const { generateGraph } = await import("../src/graph");
    await generateGraph({ rootDir: "/root" });

    expect(mocks.detectPackagesMock).toHaveBeenCalled();
    expect(mocks.fsMock.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("/mocked/"),
      "<html>ok</html>",
      "utf8",
    );
  });

  test("logs error when no packages found", async () => {
    mocks.detectPackagesMock.mockResolvedValue([]);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { generateGraph } = await import("../src/graph");
    await generateGraph({ rootDir: "/empty" });

    expect(consoleErrorSpy).toHaveBeenCalledWith("No packages found in /empty");
  });
});
