import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { GenerateReportOptions } from "../src/types";

type MockPackage = {
  name: string;
  version?: string;
  description?: string;
  relativeDir?: string;
  dependencies: string[];
  declaredDeps: string[];
  undeclaredDeps: string[];
  references: number;
  cyclicDeps: string[];
  fileCount?: number;
  isRoot?: boolean;
  hasTsconfig?: boolean;
  hasTailwindConfig?: boolean;
  hasAutoprefixer?: boolean;
  hasEslintConfig?: boolean;
  hasChildPackages?: boolean;
  toolingDeps?: string[];
  externalDependencies: {
    name: string;
    isDeclared: boolean;
    isUsed: boolean;
    usageCount: number;
    declaredInDependencies: boolean;
    declaredInDevDependencies: boolean;
    isLikelyTypePackage: boolean;
    isToolingOnly: boolean;
  }[];
  undeclaredExternalDeps: string[];
  unusedExternalDeps: string[];
};

type MockReport = {
  rootDir: string;
  packages: MockPackage[];
};

const mocks = vi.hoisted(() => {
  const writeFile = vi.fn();
  const generateDependencyReport = vi.fn<
    (
      options: GenerateReportOptions & {
        onProgress?: (msg: string, progress?: number) => void;
      },
    ) => Promise<MockReport>
  >();
  const renderHtmlReport = vi.fn(async () => "<html>report</html>");
  const serializeReportToJson = vi.fn(() => '{"ok":true}');
  const spinnerCalls: Array<{
    text: string;
    start: ReturnType<typeof vi.fn>;
    succeed: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
  }> = [];

  const oraFactory = vi.fn((text: string) => {
    const spinner = {
      text,
      start: vi.fn(() => spinner),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    spinnerCalls.push(spinner);
    return spinner;
  });

  return {
    writeFile,
    generateDependencyReport,
    renderHtmlReport,
    serializeReportToJson,
    oraFactory,
    spinnerCalls,
  };
});

vi.mock("../src/graph", () => ({
  generateDependencyReport: mocks.generateDependencyReport,
}));

vi.mock("../src/utils", () => ({
  renderHtmlReport: mocks.renderHtmlReport,
  serializeReportToJson: mocks.serializeReportToJson,
}));

vi.mock("fs/promises", () => {
  const fsModule = { writeFile: mocks.writeFile };
  return { ...fsModule, default: fsModule };
});

vi.mock("ora", () => ({
  default: mocks.oraFactory,
}));

vi.spyOn(console, "log").mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const processExitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation((() => {}) as (code?: string | number | null) => never);

async function executeCLI(): Promise<void> {
  vi.resetModules();
  await import("../src/index");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  process.argv = ["node", "index.ts"];
  mocks.spinnerCalls.length = 0;

  mocks.generateDependencyReport.mockImplementation(async (options) => {
    options.onProgress?.("Scanning packages...", 42);
    return {
      rootDir: options.rootDir ?? ".",
      packages: [
        {
          name: "@scope/pkg-a",
          version: "1.0.0",
          description: "",
          relativeDir: "packages/pkg-a",
          dependencies: [],
          declaredDeps: [],
          undeclaredDeps: [],
          references: 0,
          cyclicDeps: [],
          fileCount: 1,
          isRoot: options.rootDir === "pkg-a",
          hasTsconfig: false,
          hasTailwindConfig: false,
          hasAutoprefixer: false,
          hasEslintConfig: false,
          hasChildPackages: false,
          toolingDeps: [],
          externalDependencies: [],
          undeclaredExternalDeps: [],
          unusedExternalDeps: [],
        },
      ],
    };
  });

  mocks.renderHtmlReport.mockResolvedValue("<html>report</html>");
  mocks.serializeReportToJson.mockReturnValue('{"ok":true}');
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("index.ts (CLI Entry Point)", () => {
  test("calls generateDependencyReport with defaults and writes HTML output", async () => {
    await executeCLI();
    vi.runAllTimers();

    expect(mocks.generateDependencyReport).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: ".",
        onProgress: expect.any(Function),
      }),
    );

    expect(mocks.renderHtmlReport).toHaveBeenCalledWith(
      expect.any(Object),
      ".",
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      ".retracify.html",
      "<html>report</html>",
      "utf8",
    );
    expect(mocks.serializeReportToJson).not.toHaveBeenCalled();
  });

  test("honors CLI args and JSON format", async () => {
    process.argv = [
      "node",
      "index.ts",
      "my-repo",
      "output.json",
      "--json",
    ];
    await executeCLI();
    vi.runAllTimers();

    expect(mocks.generateDependencyReport).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "my-repo" }),
    );
    expect(mocks.serializeReportToJson).toHaveBeenCalledTimes(1);
    expect(mocks.renderHtmlReport).not.toHaveBeenCalled();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "output.json",
      '{"ok":true}',
      "utf8",
    );
  });

  test("fails gracefully when graph generation throws", async () => {
    const error = new Error("Mocked graph generation error");
    mocks.generateDependencyReport.mockRejectedValueOnce(error);

    await executeCLI();
    vi.runAllTimers();

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.spinnerCalls.at(-1)?.fail).toHaveBeenCalledWith(error.message);
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
