import { describe, test, expect, vi, beforeEach } from "vitest";
import type { GenerateGraphOptions } from "../src/types";

const generateGraphMock =
  vi.fn<(options: GenerateGraphOptions) => Promise<void>>();
vi.mock("../src/graph", () => ({
  generateGraph: generateGraphMock,
}));

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const processExitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation((() => {}) as (code?: string | number | null) => never);

async function executeCLI() {
  vi.resetModules();
  await import("../src/index");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = ["node", "index.ts"];
});

describe("index.ts (CLI Entry Point)", () => {
  test("calls generateGraph with default values", async () => {
    await executeCLI();
    expect(generateGraphMock).toHaveBeenCalledWith({
      rootDir: ".",
      outputHtml: "dependencies.html",
    });
  });

  test("uses rootDir and outputHtml from CLI args", async () => {
    process.argv = ["node", "index.ts", "my-repo", "output.html"];
    await executeCLI();
    expect(generateGraphMock).toHaveBeenCalledWith({
      rootDir: "my-repo",
      outputHtml: "output.html",
    });
  });

  test("handles generateGraph errors and exits with code 1", async () => {
    const error = new Error("Mocked graph generation error");
    generateGraphMock.mockRejectedValue(error);
    await executeCLI();
    expect(consoleErrorSpy).toHaveBeenCalledWith(error.message);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
