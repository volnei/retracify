import os from "os";
import { beforeAll, describe, expect, test } from "bun:test";
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

type CycleSampleEntry = {
  ownerName: string;
  ownerAnchor: string;
  file: string;
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
  cyclePartners: Array<{
    name: string;
    displayName: string;
    anchor: string;
    fileCount: number;
    sampleFiles: CycleSampleEntry[];
  }>;
  dependencyBadges: DependencyBadge[];
  externalDependencyBadges: Array<{ name: string }>;
  hasIssues: boolean;
  [key: string]: unknown;
};

type CycleEdgeInsight = {
  fromName: string;
  fromAnchor: string;
  toName: string;
  toAnchor: string;
  edgeCount: number;
  referenceFileCount: number;
  sampleFiles: CycleSampleEntry[];
  severity: "high" | "medium" | "low";
};

type HtmlReportPayload = {
  summary: {
    packageCount: number;
    dependencyCount: number;
    cyclicDependencyCount: number;
    cyclePackageCount: number;
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
  insights: {
    cycles: {
      packageCount: number;
      edgeCount: number;
      edges: CycleEdgeInsight[];
    };
  };
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

  const knownPackageKeys = new Set<string>();
  report.packages.forEach((pkg, index) => {
    const displayName =
      pkg.name && pkg.name.trim().length > 0
        ? pkg.name
        : pkg.relativeDir && pkg.relativeDir.trim().length > 0
          ? pkg.relativeDir
          : `package-${index + 1}`;
    if (pkg.name && pkg.name.trim().length > 0) {
      knownPackageKeys.add(pkg.name);
    }
    knownPackageKeys.add(displayName);
    if (pkg.relativeDir && pkg.relativeDir.trim().length > 0) {
      knownPackageKeys.add(pkg.relativeDir);
    }
  });

  const packagesInCycles = new Set<string>();

  report.packages.forEach((pkg, index) => {
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

    if (pkg.cyclicDeps.length > 0) {
      const displayName =
        pkg.name && pkg.name.trim().length > 0
          ? pkg.name
          : pkg.relativeDir && pkg.relativeDir.trim().length > 0
            ? pkg.relativeDir
            : `package-${index + 1}`;
      packagesInCycles.add(displayName);
      pkg.cyclicDeps.forEach((dep) => {
        if (knownPackageKeys.has(dep)) {
          packagesInCycles.add(dep);
        }
      });
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
    cyclePackageCount: packagesInCycles.size,
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

const buildExpectedCycleInsights = (
  report: RawDependencyReport,
): HtmlReportPayload["insights"]["cycles"] => {
  const displayNameByKey = new Map<string, string>();
  const anchorByKey = new Map<string, string>();

  report.packages.forEach((pkg, index) => {
    const baseDisplayName =
      pkg.name && pkg.name.trim().length > 0
        ? pkg.name
        : pkg.relativeDir && pkg.relativeDir.trim().length > 0
          ? pkg.relativeDir
          : `package-${index + 1}`;
    const registerKeys = new Set<string>();
    if (pkg.name && pkg.name.trim().length > 0) {
      registerKeys.add(pkg.name);
    }
    if (pkg.relativeDir && pkg.relativeDir.trim().length > 0) {
      registerKeys.add(pkg.relativeDir);
    }
    if (registerKeys.size === 0) {
      registerKeys.add(baseDisplayName);
    }
    const anchor = makeAnchorId(baseDisplayName);
    registerKeys.forEach((key) => {
      if (!displayNameByKey.has(key)) {
        displayNameByKey.set(key, baseDisplayName);
      }
      if (!anchorByKey.has(key)) {
        anchorByKey.set(key, anchor);
      }
    });
  });

  const resolveDisplayName = (key: string) =>
    displayNameByKey.get(key) ?? key;
  const resolveAnchor = (key: string) => anchorByKey.get(key) ?? makeAnchorId(key);

  const packagesInCycles = new Set<string>();
  const cycleEdgeMap = new Map<
    string,
    {
      aKey: string;
      bKey: string;
      edgeCount: number;
      referenceFileCount: number;
      sampleFiles: Map<string, Set<string>>;
    }
  >();

  report.packages.forEach((pkg, index) => {
    const packageDisplayName =
      pkg.name && pkg.name.trim().length > 0
        ? pkg.name
        : pkg.relativeDir && pkg.relativeDir.trim().length > 0
          ? pkg.relativeDir
          : `package-${index + 1}`;
    const packageKey =
      pkg.name && pkg.name.trim().length > 0 ? pkg.name : packageDisplayName;

    if (!Array.isArray(pkg.cyclicDeps) || pkg.cyclicDeps.length === 0) {
      return;
    }

    const dependencyDetails = Array.isArray(pkg.dependencyDetails)
      ? pkg.dependencyDetails
      : [];

    packagesInCycles.add(packageKey);

    pkg.cyclicDeps.forEach((dep) => {
      const detail = dependencyDetails.find((entry) => entry.name === dep);
      const fileCount = detail?.fileCount ?? 0;
      const sampleFiles = Array.isArray(detail?.files)
        ? detail.files.filter(
            (file): file is string => typeof file === "string" && file.length > 0,
          )
        : [];
      const [firstKey, secondKey] =
        packageKey.localeCompare(dep) <= 0 ? [packageKey, dep] : [dep, packageKey];
      const pairKey = `${firstKey}::${secondKey}`;
      const existing = cycleEdgeMap.get(pairKey);
      if (existing) {
        existing.edgeCount += 1;
        existing.referenceFileCount += fileCount;
        const currentSet = existing.sampleFiles.get(packageKey) ?? new Set<string>();
        sampleFiles.forEach((file) => currentSet.add(file));
        existing.sampleFiles.set(packageKey, currentSet);
      } else {
        cycleEdgeMap.set(pairKey, {
          aKey: firstKey,
          bKey: secondKey,
          edgeCount: 1,
          referenceFileCount: fileCount,
          sampleFiles: sampleFiles.length
            ? new Map([[packageKey, new Set(sampleFiles)]])
            : new Map(),
        });
      }
      if (displayNameByKey.has(dep) || anchorByKey.has(dep)) {
        packagesInCycles.add(dep);
      }
    });
  });

  const edges = Array.from(cycleEdgeMap.values())
    .map((entry) => {
      const severity =
        entry.referenceFileCount >= 10 || entry.edgeCount >= 6
          ? "high"
          : entry.referenceFileCount >= 4 || entry.edgeCount >= 3
            ? "medium"
            : "low";
      const sampleDetails: CycleSampleEntry[] = [];
      entry.sampleFiles.forEach((files, ownerKey) => {
        const ownerName = resolveDisplayName(ownerKey);
        const ownerAnchor = resolveAnchor(ownerKey);
        files.forEach((file) => {
          sampleDetails.push({ ownerName, ownerAnchor, file });
        });
      });
      const sampleFiles = sampleDetails.slice(0, 5);
      return {
        fromName: resolveDisplayName(entry.aKey),
        fromAnchor: resolveAnchor(entry.aKey),
        toName: resolveDisplayName(entry.bKey),
        toAnchor: resolveAnchor(entry.bKey),
        edgeCount: entry.edgeCount,
        referenceFileCount: entry.referenceFileCount,
        sampleFiles,
        severity,
      };
    })
    .sort((a, b) => {
      if (b.referenceFileCount !== a.referenceFileCount) {
        return b.referenceFileCount - a.referenceFileCount;
      }
      if (b.edgeCount !== a.edgeCount) {
        return b.edgeCount - a.edgeCount;
      }
      const nameA = `${a.fromName}-${a.toName}`;
      const nameB = `${b.fromName}-${b.toName}`;
      return nameA.localeCompare(nameB);
    });

  return {
    packageCount: packagesInCycles.size,
    edgeCount: edges.length,
    edges,
  };
};

async function loadReportHtml(rootDir: string): Promise<{
  report: RawDependencyReport;
  html: string;
}> {
  const [graphModule, utilsModule] = await Promise.all([
    import("../src/graph?actual"),
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
    /<script id=\"reportData\" type=\"application\/json\">([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("Report payload script block not found in generated HTML");
  }
  const raw = match[1].trim();
  const data = JSON.parse(raw) as HtmlReportPayload;
  return { raw, data };
};

describe("generated report e2e", () => {
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
        const expectedCycleInsights = buildExpectedCycleInsights(report);
        expect(data.insights?.cycles?.packageCount).toBe(
          expectedCycleInsights.packageCount,
        );
        expect(data.insights?.cycles?.edgeCount).toBe(
          expectedCycleInsights.edgeCount,
        );
        expect(data.insights?.cycles?.edges).toEqual(
          expectedCycleInsights.edges,
        );

        const expectedSystemInfo = `${os.type()} ${os.release()} (${os.arch()})`;
        expect(data.meta.rootDir).toBe(report.rootDir);
        expect(data.meta.nodeVersion).toBe(process.version);
        expect(data.meta.systemInfo).toBe(expectedSystemInfo);
        expect(typeof data.meta.generatedAt).toBe("string");
        expect(data.meta.generatedAt.trim().length).toBeGreaterThan(0);

        const anchorLookup = new Map<string, string>();
        data.packages.forEach((pkgView, idx) => {
          const source = report.packages[idx];
          if (source.name && source.name.trim().length > 0) {
            anchorLookup.set(source.name, pkgView.anchorId);
          }
          if (source.relativeDir && source.relativeDir.trim().length > 0) {
            anchorLookup.set(source.relativeDir, pkgView.anchorId);
          }
          anchorLookup.set(pkgView.displayName, pkgView.anchorId);
        });

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
          ).toEqual(
            pkg.dependencies.map(
              (dep) => anchorLookup.get(dep) ?? makeAnchorId(dep),
            ),
          );

          expect(view.cyclePartners.map((partner) => partner.name)).toEqual(
            pkg.cyclicDeps,
          );
          expect(
            view.cyclePartners.map((partner) => partner.anchor),
          ).toEqual(
            pkg.cyclicDeps.map(
              (dep) => anchorLookup.get(dep) ?? makeAnchorId(dep),
            ),
          );
          view.cyclePartners.forEach((partner) => {
            partner.sampleFiles.forEach((sample) => {
              expect(sample.ownerName).toBe(view.displayName);
              expect(sample.ownerAnchor).toBe(view.anchorId);
              expect(typeof sample.file).toBe("string");
            });
          });

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
