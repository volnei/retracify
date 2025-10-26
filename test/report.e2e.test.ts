import os from "os";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ProjectFixture } from "./fixtures/shared";
import { createSimpleProjectFixture } from "./fixtures/simple-project";
import { createWorkspaceFixture } from "./fixtures/workspace-project";

type RawExternalDependency = {
  name: string;
  isDeclared: boolean;
  isUsed: boolean;
  usageCount: number;
  declaredInDependencies: boolean;
  declaredInDevDependencies: boolean;
  isLikelyTypePackage: boolean;
  isToolingOnly: boolean;
};

type RawDependencyReportPackage = {
  name: string;
  version?: string;
  description?: string;
  relativeDir?: string;
  isRoot?: boolean;
  dependencies: string[];
  references: number;
  declaredDeps: string[];
  undeclaredDeps: string[];
  cyclicDeps: string[];
  fileCount?: number;
  hasTsconfig?: boolean;
  hasTailwindConfig?: boolean;
  hasAutoprefixer?: boolean;
  hasEslintConfig?: boolean;
  hasChildPackages?: boolean;
  toolingDeps?: string[];
  dependencyDetails?: Array<{
    name: string;
    fileCount: number;
    files: string[];
  }>;
  externalDependencies: RawExternalDependency[];
  undeclaredExternalDeps: string[];
  unusedExternalDeps: string[];
};

type RawDependencyReport = {
  rootDir: string;
  packages: RawDependencyReportPackage[];
};

type DependencyBadge = {
  name: string;
  anchor: string;
  isCyclic: boolean;
  isUndeclared: boolean;
};

type HtmlReportPackage = RawDependencyReportPackage & {
  displayName: string;
  anchorId: string;
  runtimeExternalCount: number;
  toolingExternalCount: number;
  typeExternalCount: number;
  toolingDepsList: string[];
  dependencyBadges: DependencyBadge[];
  externalDependencyBadges: Array<{ name: string }>;
  hasIssues: boolean;
  [key: string]: unknown;
};

type HtmlReportPayload = {
  summary: {
    packageCount: number;
    dependencyCount: number;
    cyclicDependencyCount: number;
    undeclaredDependencyCount: number;
    runtimeExternalCount: number;
    toolingExternalCount: number;
    typeExternalCount: number;
    toolingDependencyCount: number;
    packagesWithIssues: number;
    averageDependencyCount: number;
    averageToolingDeps: number;
  };
  packages: HtmlReportPackage[];
  meta: {
    rootDir: string;
    generatedAt: string;
    systemInfo: string;
    nodeVersion: string;
  };
};

type ExtractedPayload = {
  raw: string;
  data: HtmlReportPayload;
};

const makeAnchorId = (name: string): string =>
  name.replace(/[@/]/g, "-").replace(/^-+|-+$/g, "");

const uniqueSorted = (input: string[] | undefined): string[] => {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }
  return Array.from(new Set(input)).sort();
};

const computeExternalBreakdown = (deps: RawExternalDependency[]) => {
  let runtime = 0;
  let tooling = 0;
  let type = 0;
  for (const dep of deps) {
    if (!dep.isToolingOnly && !dep.isLikelyTypePackage) {
      runtime += 1;
    }
    if (dep.isToolingOnly) {
      tooling += 1;
    }
    if (dep.isLikelyTypePackage) {
      type += 1;
    }
  }
  return { runtime, tooling, type };
};

const buildExpectedSummary = (
  report: RawDependencyReport,
): HtmlReportPayload["summary"] => {
  const packageCount = report.packages.length;

  let dependencyCount = 0;
  let cyclicDependencyCount = 0;
  let undeclaredDependencyCount = 0;
  let runtimeExternalCount = 0;
  let toolingExternalCount = 0;
  let typeExternalCount = 0;
  let toolingDependencyCount = 0;
  let packagesWithIssues = 0;

  report.packages.forEach((pkg) => {
    dependencyCount += pkg.dependencies.length;
    cyclicDependencyCount += pkg.cyclicDeps.length;
    undeclaredDependencyCount += pkg.undeclaredDeps.length;

    const { runtime, tooling, type } = computeExternalBreakdown(
      pkg.externalDependencies,
    );
    runtimeExternalCount += runtime;
    toolingExternalCount += tooling;
    typeExternalCount += type;

    toolingDependencyCount += uniqueSorted(pkg.toolingDeps).length;

    const undeclaredExternalCount = pkg.undeclaredExternalDeps.length;
    const unusedExternalCount = pkg.unusedExternalDeps.length;
    const hasIssues =
      pkg.undeclaredDeps.length > 0 ||
      undeclaredExternalCount > 0 ||
      unusedExternalCount > 0;
    if (hasIssues) {
      packagesWithIssues += 1;
    }
  });

  const averageDependencyCount =
    packageCount > 0
      ? Number((dependencyCount / packageCount).toFixed(1))
      : 0;
  const averageToolingDeps =
    packageCount > 0
      ? Number((toolingDependencyCount / packageCount).toFixed(1))
      : 0;

  return {
    packageCount,
    dependencyCount,
    cyclicDependencyCount,
    undeclaredDependencyCount,
    runtimeExternalCount,
    toolingExternalCount,
    typeExternalCount,
    toolingDependencyCount,
    packagesWithIssues,
    averageDependencyCount,
    averageToolingDeps,
  };
};

async function loadReportHtml(rootDir: string): Promise<{
  report: RawDependencyReport;
  html: string;
}> {
  vi.resetModules();
  const [graphModule, utilsModule] = await Promise.all([
    import("../src/graph"),
    import("../src/utils"),
  ]);
  const report = (await graphModule.generateDependencyReport({
    rootDir,
  })) as RawDependencyReport;
  const html = await utilsModule.renderHtmlReport(
    report as Parameters<typeof utilsModule.renderHtmlReport>[0],
    rootDir,
  );
  return { report, html };
}

const extractPayload = (html: string): ExtractedPayload => {
  const match = html.match(
    /<script id="reportData" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("Report payload script block not found in generated HTML");
  }
  const raw = match[1].trim();
  const data = JSON.parse(raw) as HtmlReportPayload;
  return { raw, data };
};

describe("generated report e2e", () => {
  beforeAll(() => {
    vi.doUnmock("ts-morph");
    vi.doUnmock("../src/utils");
    vi.doUnmock("../src/graph");
  });

  const scenarios: Array<[string, () => Promise<ProjectFixture>]> = [
    ["a simple project", createSimpleProjectFixture],
    ["a workspace project", createWorkspaceFixture],
  ];

  test.each(scenarios)(
    "produces a self-consistent payload for %s",
    async (_label, factory) => {
      const fixture = await factory();
      try {
        const { report, html } = await loadReportHtml(fixture.rootDir);
        const { raw, data } = extractPayload(html);

        expect(html).toContain('id="app-root"');
        expect(raw.startsWith("{")).toBe(true);
        expect(raw).not.toContain("<");

        expect(data.packages).toHaveLength(report.packages.length);
        expect(data.summary).toMatchObject(buildExpectedSummary(report));

        const expectedSystemInfo = `${os.type()} ${os.release()} (${os.arch()})`;
        expect(data.meta.rootDir).toBe(report.rootDir);
        expect(data.meta.nodeVersion).toBe(process.version);
        expect(data.meta.systemInfo).toBe(expectedSystemInfo);
        expect(typeof data.meta.generatedAt).toBe("string");
        expect(data.meta.generatedAt.trim().length).toBeGreaterThan(0);

        const seenAnchors = new Set<string>();
        report.packages.forEach((pkg, index) => {
          const view = data.packages[index];
          expect(view.anchorId).toBe(makeAnchorId(view.displayName));
          expect(seenAnchors.has(view.anchorId)).toBe(false);
          seenAnchors.add(view.anchorId);

          const expectedDisplayName =
            pkg.name?.trim().length
              ? pkg.name
              : pkg.relativeDir?.trim().length
                ? pkg.relativeDir
                : `package-${index + 1}`;
          expect(view.displayName).toBe(expectedDisplayName);
          expect(view.dependencies).toEqual(pkg.dependencies);
          expect(view.undeclaredDeps).toEqual(pkg.undeclaredDeps);
          expect(view.cyclicDeps).toEqual(pkg.cyclicDeps);

          expect(view.dependencyBadges.map((badge) => badge.name)).toEqual(
            pkg.dependencies,
          );
          expect(
            view.dependencyBadges.map((badge) => badge.anchor),
          ).toEqual(pkg.dependencies.map((dep) => makeAnchorId(dep)));

          const { runtime, tooling, type } = computeExternalBreakdown(
            pkg.externalDependencies,
          );
          expect(view.runtimeExternalCount).toBe(runtime);
          expect(view.toolingExternalCount).toBe(tooling);
          expect(view.typeExternalCount).toBe(type);

          expect(view.toolingDepsList).toEqual(uniqueSorted(pkg.toolingDeps));

          const undeclaredExternalCount = pkg.undeclaredExternalDeps.length;
          const unusedExternalCount = pkg.unusedExternalDeps.length;
          const hasIssues =
            pkg.undeclaredDeps.length > 0 ||
            undeclaredExternalCount > 0 ||
            unusedExternalCount > 0;
          expect(view.hasIssues).toBe(hasIssues);
        });

        expect(seenAnchors.size).toBe(data.packages.length);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});
