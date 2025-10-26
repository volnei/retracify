import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PkgInfo } from "../src/types";
import {
  normalizeImportSpecifier,
  renderHtmlReport,
  discoverPackages,
  collectSourceFiles,
} from "../src/utils";

const mocks = vi.hoisted(() => {
  const globMock = vi.fn();
  const readFileMock = vi.fn();
  const writeFileMock = vi.fn();
  return { globMock, readFileMock, writeFileMock };
});

vi.mock("fast-glob", () => ({
  default: mocks.globMock,
}));

vi.mock("fs/promises", () => {
  const mockFs = {
    readFile: mocks.readFileMock,
    writeFile: mocks.writeFileMock,
  };
  return { ...mockFs, default: mockFs };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.globMock.mockReset();
  mocks.readFileMock.mockReset();
  mocks.writeFileMock.mockReset();
  mocks.globMock.mockResolvedValue([]);
});

describe("utils.ts - Pure Functions", () => {
  test("normalizeImportSpecifier extracts base name correctly", () => {
    expect(normalizeImportSpecifier("my-package")).toBe("my-package");
    expect(normalizeImportSpecifier("my-package/subpath")).toBe("my-package");
    expect(normalizeImportSpecifier("@scope/name")).toBe("@scope/name");
    expect(normalizeImportSpecifier("@scope/name/file")).toBe("@scope/name");
  });

  test("renderHtmlReport generates markup for packages", async () => {
    mocks.readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("report.ejs")) {
        return `
          <html>
            <body>
              <script id="reportData" type="application/json"><%- clientPayload %></script>
            </body>
          </html>
        `;
      }
      throw new Error(`Unexpected read: ${filePath}`);
    });

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
    };

    const html = await renderHtmlReport(mockReport, process.cwd());
    expect(html).toContain("@scope/pkg-a");
    expect(html).toContain("@scope/pkg-b");
  });
});

describe("utils.ts - I/O Functions", () => {
  const rootDir = ".";

  test("discoverPackages finds and reads multiple package.json files", async () => {
    const mockFiles = [
      "/mocked/root/pkg1/package.json",
      "/mocked/root/pkg2/package.json",
    ];

    mocks.globMock.mockResolvedValueOnce(mockFiles);
    mocks.readFileMock
      .mockResolvedValueOnce(
        JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ name: "pkg-b", version: "2.0.0" }),
      );

    const packages: PkgInfo[] = await discoverPackages(rootDir);

    expect(mocks.globMock).toHaveBeenCalled();
    expect(packages).toHaveLength(2);
    expect(packages[0].name).toBe("pkg-a");
    expect(packages[0].dir).toContain("/pkg1");
  });

  test("discoverPackages excludes nested package directories from file counts", async () => {
    mocks.globMock.mockResolvedValueOnce([
      "/repo/package.json",
      "/repo/packages/child/package.json",
    ]);

    mocks.readFileMock
      .mockResolvedValueOnce(
        JSON.stringify({ name: "root", version: "1.0.0" }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ name: "child", version: "1.0.0" }),
      );

    const packages = await discoverPackages(".");

    expect(packages).toHaveLength(2);
    const rootPkg = packages.find((pkg) => pkg.name === "root")!;
    expect(rootPkg.fileCount).toBe(0);

    const rootGlobCall = mocks.globMock.mock.calls[1];
    expect(rootGlobCall?.[1]?.ignore).toContain("packages/child/**");
  });

  test("collectSourceFiles uses the correct glob pattern", async () => {
    const expectedFiles = ["file1.ts", "file2.js"];
    mocks.globMock.mockResolvedValue(expectedFiles);

    const files = await collectSourceFiles(rootDir, ["**/ignore/**"]);

    expect(mocks.globMock).toHaveBeenCalled();
    expect(files).toEqual(expectedFiles);
  });
});
