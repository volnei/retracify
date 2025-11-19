import path from "path";
import { describe, test, expect } from "bun:test";
import type { EdgeMap } from "../src/types";
import {
  buildPackageDirectoryMap,
  resolvePackageForFile,
  identifyCyclicEdges,
  analyzeImportGraph,
  generateDependencyReport,
} from "../src/graph";
import { discoverPackages, loadTsconfigAliasResolvers } from "../src/utils";
import { createWorkspaceFixture } from "./fixtures/workspace-project";

describe("graph.ts - Helper Functions", () => {
  test("buildPackageDirectoryMap and resolvePackageForFile work correctly", () => {
    const pkgs = [
      { name: "pkg-root", dir: "/root" },
      { name: "pkg-a", dir: "/root/pkg-a" },
      { name: "pkg-b", dir: "/root/libs/pkg-b" },
    ];

    const map = buildPackageDirectoryMap(pkgs as any);
    expect(map.get("/root")).toBe("pkg-root");
    expect(map.get("/root/pkg-a")).toBe("pkg-a");

    expect(resolvePackageForFile("/root/pkg-a/src/index.ts", map)).toBe(
      "pkg-a",
    );
    expect(resolvePackageForFile("/root/libs/pkg-b/lib/index.ts", map)).toBe(
      "pkg-b",
    );
    expect(resolvePackageForFile("/root/index.ts", map)).toBe("pkg-root");
  });

  test("identifyCyclicEdges flags a simple cycle", () => {
    const edges: EdgeMap = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    const result = identifyCyclicEdges(edges);
    expect(result.has("a->b")).toBe(true);
    expect(result.has("b->a")).toBe(true);
  });
});

describe("graph.ts - workspace analysis", () => {
  test("analyzeImportGraph captures internal dependency edges", async () => {
    const fixture = await createWorkspaceFixture();
    try {
      const pkgs = await discoverPackages(fixture.rootDir);
      const aliasResolvers = await loadTsconfigAliasResolvers(
        fixture.rootDir,
        [],
      );
      const { edges } = await analyzeImportGraph(
        fixture.rootDir,
        pkgs,
        ["**/node_modules/**"],
        aliasResolvers,
      );

      const appEdges = edges.get("@workspace/app-one");
      expect(appEdges?.has("@workspace/ui")).toBe(true);
      expect(appEdges?.has("@workspace/utils")).toBe(true);
      expect(appEdges?.has("@workspace/platform-core")).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test("generateDependencyReport returns expected package metadata", async () => {
    const fixture = await createWorkspaceFixture();
    try {
      const report = await generateDependencyReport({
        rootDir: fixture.rootDir,
      });
      expect(report.rootDir).toBe(path.resolve(fixture.rootDir));
      const appOne = report.packages.find(
        (pkg) => pkg.name === "@workspace/app-one",
      );
      expect(appOne).toBeDefined();
      expect(appOne?.dependencies).toContain("@workspace/ui");
      expect(
        appOne?.externalDependencies.some((dep) => dep.name === "react"),
      ).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test("type-only imports are ignored for runtime dependency edges", async () => {
    const fixture = await createWorkspaceFixture();
    try {
      const report = await generateDependencyReport({
        rootDir: fixture.rootDir,
      });
      const typeOnlyPkg = report.packages.find(
        (pkg) => pkg.name === "@workspace/type-only",
      );
      expect(typeOnlyPkg).toBeDefined();
      expect(typeOnlyPkg?.dependencies).not.toContain("@workspace/ui");
    } finally {
      await fixture.cleanup();
    }
  });
});
