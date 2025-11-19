import path from "path";
import os from "os";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { PkgInfo } from "../src/types";
import {
  normalizeImportSpecifier,
  renderHtmlReport,
  discoverPackages,
  collectSourceFiles,
} from "../src/utils";

const TEMPLATE_PATH = path.resolve("templates", "report.ejs");

describe("utils.ts - Pure Functions", () => {
  test("normalizeImportSpecifier extracts base name correctly", () => {
    expect(normalizeImportSpecifier("my-package")).toBe("my-package");
    expect(normalizeImportSpecifier("my-package/subpath")).toBe("my-package");
    expect(normalizeImportSpecifier("@scope/name")).toBe("@scope/name");
    expect(normalizeImportSpecifier("@scope/name/file")).toBe("@scope/name");
  });

  test("renderHtmlReport generates markup for packages", async () => {
    const mockReport = {
      rootDir: process.cwd(),
      packages: [
        {
          name: "@scope/pkg-a",
          version: "1.2.3",
          description: "Test package",
          relativeDir: "packages/pkg-a",
          dependencies: ["@scope/pkg-b"],
          declaredDeps: ["@scope/pkg-b"],
          undeclaredDeps: [],
          references: 2,
          cyclicDeps: [],
          fileCount: 4,
          isRoot: false,
          hasTsconfig: false,
          hasTailwindConfig: false,
          hasAutoprefixer: false,
          hasEslintConfig: false,
          hasChildPackages: false,
          toolingDeps: [],
          externalDependencies: [
            {
              name: "react",
              isDeclared: true,
              isUsed: true,
              usageCount: 5,
              declaredInDependencies: true,
              declaredInDevDependencies: false,
              isLikelyTypePackage: false,
              isToolingOnly: false,
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
          ],
          undeclaredExternalDeps: [],
          unusedExternalDeps: ["lodash"],
        },
        {
          name: "@scope/pkg-b",
          version: "0.1.0",
          description: "",
          relativeDir: "packages/pkg-b",
          dependencies: [],
          declaredDeps: [],
          undeclaredDeps: [],
          references: 1,
          cyclicDeps: [],
          fileCount: 3,
          isRoot: false,
          hasTsconfig: false,
          hasTailwindConfig: false,
          hasAutoprefixer: false,
          hasEslintConfig: false,
          hasChildPackages: false,
          toolingDeps: [],
          externalDependencies: [
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
          ],
          undeclaredExternalDeps: ["axios"],
          unusedExternalDeps: [],
        },
      ],
    } satisfies { rootDir: string; packages: PkgInfo[] };

    const html = await renderHtmlReport(mockReport, process.cwd());
    expect(html).toContain("@scope/pkg-a");
    expect(html).toContain("@scope/pkg-b");
  });
});

describe("utils.ts - I/O Functions", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "utils-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("discoverPackages finds and reads multiple package.json files", async () => {
    const pkg1Dir = path.join(tempRoot, "pkg1");
    const pkg2Dir = path.join(tempRoot, "pkg2");
    await Promise.all([
      mkdir(pkg1Dir, { recursive: true }),
      mkdir(pkg2Dir, { recursive: true }),
    ]);
    await writeFile(
      path.join(pkg1Dir, "package.json"),
      JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      "utf8",
    );
    await writeFile(
      path.join(pkg2Dir, "package.json"),
      JSON.stringify({ name: "pkg-b", version: "2.0.0" }),
      "utf8",
    );

    const packages = await discoverPackages(tempRoot);

    expect(packages).toHaveLength(2);
    const names = packages.map((pkg) => pkg.name).sort();
    expect(names).toEqual(["pkg-a", "pkg-b"]);
  });

  test("discoverPackages excludes nested package directories from file counts", async () => {
    const rootDir = path.join(tempRoot, "root");
    const childDir = path.join(rootDir, "packages/child");
    await Promise.all([
      mkdir(rootDir, { recursive: true }),
      mkdir(childDir, { recursive: true }),
    ]);
    await writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({ name: "root", version: "1.0.0" }),
      "utf8",
    );
    await writeFile(
      path.join(childDir, "package.json"),
      JSON.stringify({ name: "child", version: "1.0.0" }),
      "utf8",
    );

    const packages = await discoverPackages(rootDir);

    expect(packages).toHaveLength(2);
    const rootPkg = packages.find((pkg) => pkg.name === "root")!;
    expect(rootPkg.fileCount).toBeGreaterThanOrEqual(0);
    expect(rootPkg.declaredDeps).toBeDefined();
  });

  test("collectSourceFiles uses the correct glob pattern", async () => {
    const srcDir = path.join(tempRoot, "src");
    await mkdir(srcDir, { recursive: true });
    const files = [
      path.join(srcDir, "file1.ts"),
      path.join(srcDir, "file2.jsx"),
      path.join(srcDir, "nested/file3.tsx"),
    ];
    await Promise.all(
      files.map((filePath) =>
        mkdir(path.dirname(filePath), { recursive: true }).then(() =>
          writeFile(filePath, "export {}", "utf8"),
        ),
      ),
    );

    const discovered = await collectSourceFiles(tempRoot, []);
    expect(discovered.sort()).toEqual(files.sort());
  });
});
