import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PkgInfo } from "../src/types";
import {
  normalizePackageName,
  createHtmlTemplate,
  detectPackages,
  findSourceFiles,
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
});

describe("utils.ts - Pure Functions", () => {
  test("normalizePackageName extracts base name correctly", () => {
    expect(normalizePackageName("my-package")).toBe("my-package");
    expect(normalizePackageName("my-package/subpath")).toBe("my-package");
    expect(normalizePackageName("@scope/name")).toBe("@scope/name");
    expect(normalizePackageName("@scope/name/file")).toBe("@scope/name");
  });

  test("createHtmlTemplate generates valid HTML with Mermaid content", () => {
    const content = "graph TD; A-->B;";
    const html = createHtmlTemplate(content);
    expect(html).toContain(content.trim());
    expect(html).toContain("mermaid.min.js");
  });
});

describe("utils.ts - I/O Functions", () => {
  const rootDir = ".";

  test("detectPackages finds and reads multiple package.json files", async () => {
    const mockFiles = [
      "/mocked/root/pkg1/package.json",
      "/mocked/root/pkg2/package.json",
    ];

    mocks.globMock.mockResolvedValue(mockFiles);
    mocks.readFileMock
      .mockResolvedValueOnce(
        JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ name: "pkg-b", version: "2.0.0" }),
      );

    const packages: PkgInfo[] = await detectPackages(rootDir);

    expect(mocks.globMock).toHaveBeenCalled();
    expect(packages).toHaveLength(2);
    expect(packages[0].name).toBe("pkg-a");
    expect(packages[0].dir).toContain("/pkg1");
  });

  test("findSourceFiles uses the correct glob pattern", async () => {
    const expectedFiles = ["file1.ts", "file2.js"];
    mocks.globMock.mockResolvedValue(expectedFiles);

    const files = await findSourceFiles(rootDir, ["**/ignore/**"]);

    expect(mocks.globMock).toHaveBeenCalled();
    expect(files).toEqual(expectedFiles);
  });
});
