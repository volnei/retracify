import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { createWorkspaceFixture } from "./fixtures/workspace-project";
import { createSimpleProjectFixture } from "./fixtures/simple-project";
import type { ProjectFixture } from "./fixtures/shared";

describe("generateDependencyReport integration", () => {
  beforeAll(() => {
    vi.doUnmock("ts-morph");
    vi.doUnmock("../src/utils");
    vi.doUnmock("../src/graph");
  });

  describe("workspace project", () => {
    let fixture: ProjectFixture;

    beforeAll(async () => {
      fixture = await createWorkspaceFixture();
    });

    afterAll(async () => {
      await fixture.cleanup();
    });

    async function loadReport() {
      vi.resetModules();
      const { generateDependencyReport } = await import("../src/graph");
      return generateDependencyReport({ rootDir: fixture.rootDir });
    }

    function pickPackage(
      report: Awaited<ReturnType<typeof loadReport>>,
      name: string,
    ) {
      const pkg = report.packages.find((candidate) => candidate.name === name);
      if (!pkg) throw new Error(`Package ${name} not found in report`);
      return pkg;
    }

    test("captures declared, undeclared, and nested workspace relationships", async () => {
      const report = await loadReport();

      const appOne = pickPackage(report, "@workspace/app-one");
      expect(appOne.dependencies.sort()).toEqual(
        ["@workspace/platform-core", "@workspace/ui", "@workspace/utils"].sort(),
      );
      expect(appOne.declaredDeps.sort()).toEqual(
        ["@workspace/platform-core", "@workspace/ui", "@workspace/utils"].sort(),
      );
      expect(appOne.undeclaredDeps).toEqual([]);
      expect(
        appOne.externalDependencies
          .map((dep) => ({ ...dep }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual([
        {
          name: "@types/react",
          isDeclared: true,
          isUsed: false,
          usageCount: 0,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: true,
          isToolingOnly: false,
        },
        {
          name: "@typescript-eslint/eslint-plugin",
          isDeclared: true,
          isUsed: true,
          usageCount: 0,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
        {
          name: "@typescript-eslint/parser",
          isDeclared: true,
          isUsed: true,
          usageCount: 0,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
        {
          name: "autoprefixer",
          isDeclared: true,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
        {
          name: "eslint",
          isDeclared: true,
          isUsed: true,
          usageCount: 0,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
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
        {
          name: "prettier",
          isDeclared: true,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
        {
          name: "react",
          isDeclared: true,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: true,
          declaredInDevDependencies: false,
          isLikelyTypePackage: false,
          isToolingOnly: false,
        },
        {
          name: "tailwindcss",
          isDeclared: true,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
        {
          name: "typescript",
          isDeclared: true,
          isUsed: true,
          usageCount: 0,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
        {
          name: "vite",
          isDeclared: true,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
        {
          name: "vitest",
          isDeclared: true,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: false,
          declaredInDevDependencies: true,
          isLikelyTypePackage: false,
          isToolingOnly: true,
        },
      ]);
      expect(appOne.unusedExternalDeps).toEqual(["lodash"]);
      expect(appOne.unusedExternalDeps).not.toContain("@types/react");
      expect(appOne.unusedExternalDeps).not.toContain("@typescript-eslint/eslint-plugin");
      expect(appOne.unusedExternalDeps).not.toContain("@typescript-eslint/parser");
      expect(appOne.unusedExternalDeps).not.toContain("autoprefixer");
      expect(appOne.unusedExternalDeps).not.toContain("vite");
      expect(appOne.unusedExternalDeps).not.toContain("vitest");
      expect(appOne.unusedExternalDeps).not.toContain("prettier");
      expect(appOne.unusedExternalDeps).not.toContain("tailwindcss");
      expect(appOne.unusedExternalDeps).not.toContain("typescript");
      expect(appOne.undeclaredExternalDeps).toEqual([]);

      const appTwo = pickPackage(report, "@workspace/app-two");
      expect(appTwo.dependencies.sort()).toEqual(
        ["@workspace/ui", "@workspace/utils"].sort(),
      );
      expect(appTwo.declaredDeps).toEqual(["@workspace/ui"]);
      expect(appTwo.undeclaredDeps).toEqual(["@workspace/utils"]);
      expect(
        appTwo.externalDependencies
          .map((dep) => ({ ...dep }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual([
        {
          name: "axios",
          isDeclared: false,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: false,
          declaredInDevDependencies: false,
          isLikelyTypePackage: false,
          isToolingOnly: false,
        },
        {
          name: "react",
          isDeclared: true,
          isUsed: true,
          usageCount: 1,
          declaredInDependencies: true,
          declaredInDevDependencies: false,
          isLikelyTypePackage: false,
          isToolingOnly: false,
        },
      ]);
      expect(appTwo.unusedExternalDeps).toEqual([]);
      expect(appTwo.undeclaredExternalDeps).toEqual(["axios"]);

      const utilsPkg = pickPackage(report, "@workspace/utils");
      expect(utilsPkg.references).toBeGreaterThanOrEqual(2);
      expect(utilsPkg.externalDependencies).toEqual([]);

      const designSystem = pickPackage(report, "@workspace/design-system");
      expect(designSystem.dependencies).toEqual([]);
      expect(designSystem.undeclaredDeps).toEqual([]);
      expect(designSystem.externalDependencies).toEqual([]);

      const rootPkg = pickPackage(report, "workspace-root");
      expect(rootPkg.isRoot).toBe(true);
      expect(rootPkg.dependencies).toEqual([]);
      expect(rootPkg.externalDependencies).toEqual([]);
    });

    test("reports cyclic dependencies symmetrically", async () => {
      const report = await loadReport();

      const platformCore = pickPackage(report, "@workspace/platform-core");
      const platformGateway = pickPackage(report, "@workspace/platform-gateway");

      expect(platformCore.dependencies).toContain("@workspace/platform-gateway");
      expect(platformGateway.dependencies).toContain("@workspace/platform-core");
      expect(platformCore.cyclicDeps).toContain("@workspace/platform-gateway");
      expect(platformGateway.cyclicDeps).toContain("@workspace/platform-core");
    });
  });

  describe("single-package project", () => {
    let fixture: ProjectFixture;

    beforeAll(async () => {
      fixture = await createSimpleProjectFixture();
    });

    afterAll(async () => {
      await fixture.cleanup();
    });

    async function loadReport() {
      vi.resetModules();
      const { generateDependencyReport } = await import("../src/graph");
      return generateDependencyReport({ rootDir: fixture.rootDir });
    }

    test("detects declared and undeclared external usage", async () => {
      const report = await loadReport();

      expect(report.packages.length).toBeGreaterThanOrEqual(1);
      const pkg = report.packages.find(
        (candidate) => candidate.name === "simple-app",
      );
      expect(pkg).toBeDefined();
      if (!pkg) return;

      expect(pkg.isRoot).toBe(true);
      expect(pkg.dependencies).toEqual([]);

      const lodashDep = pkg.externalDependencies.find(
        (dep) => dep.name === "lodash",
      );
      expect(lodashDep).toBeDefined();
      expect(lodashDep).toMatchObject({
        isDeclared: true,
        isUsed: true,
      });

      const axiosDep = pkg.externalDependencies.find(
        (dep) => dep.name === "axios",
      );
      expect(axiosDep).toBeDefined();
      expect(axiosDep).toMatchObject({
        isDeclared: false,
        isUsed: true,
      });

      expect(pkg.undeclaredExternalDeps).toContain("axios");
      expect(pkg.unusedExternalDeps).not.toContain("lodash");
    });
  });
});
