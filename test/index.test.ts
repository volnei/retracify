import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import type { ChalkInstance } from "chalk";

const startLiveUiServer = mock<(
  options: {
    rootDir: string;
    port: number;
    host: string;
    generateReport: unknown;
    ora: unknown;
    chalk: ChalkInstance;
    autoOpen: boolean;
  },
) => Promise<void>>();

const spinnerCalls: Array<{ text: string }> = [];

const oraFactory = mock((text: string) => {
  spinnerCalls.push({ text });
  return {
    text,
    start: () => ({
      succeed: () => {},
      fail: () => {},
    }),
  } as any;
});

const chalkStub: Partial<ChalkInstance> = {
  hex: () => {
    const fn = (value: string) => value;
    (fn as any).bold = (value: string) => value;
    return fn as any;
  },
  red: (value: string) => value,
  gray: (value: string) => value,
  cyan: (value: string) => value,
  green: (value: string) => value,
  yellow: (value: string) => value,
  bold: (value: string) => value,
};

let consoleLogSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;
let processExitSpy: ReturnType<typeof spyOn>;

async function executeCLI(argv: string[]): Promise<void> {
  process.argv = ["node", "index.ts", ...argv];
  await import(`../src/index?run=${Math.random()}`);
}

beforeEach(() => {
  mock.clearAllMocks();
  spinnerCalls.length = 0;
  (globalThis as any).__retracifyMocks = {
    startLiveUiServer,
    ora: oraFactory,
    chalk: chalkStub,
  };
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  processExitSpy = spyOn(process, "exit").mockImplementation((() => {}) as any);
});

afterEach(() => {
  delete (globalThis as any).__retracifyMocks;
  processExitSpy.mockRestore();
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe("CLI entrypoint", () => {
  test("starts live UI with default options", async () => {
    startLiveUiServer.mockResolvedValue();

    await executeCLI([]);

    expect(processExitSpy).not.toHaveBeenCalled();
    expect(startLiveUiServer).toHaveBeenCalledTimes(1);
    expect(startLiveUiServer).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: ".",
        port: 4173,
        host: "127.0.0.1",
        autoOpen: true,
      }),
    );
  });

  test("respects positional root dir and flags", async () => {
    startLiveUiServer.mockResolvedValue();

    await executeCLI(["../packages/app", "--port", "4321", "--host", "0.0.0.0", "--no-open"]);

    expect(startLiveUiServer).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: "../packages/app",
        port: 4321,
        host: "0.0.0.0",
        autoOpen: false,
      }),
    );
  });

  test("shows help and exits when --help is provided", async () => {
    await executeCLI(["--help"]);

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(startLiveUiServer).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  test("fails on invalid port", async () => {
    await executeCLI(["--port", "abc"]);

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(startLiveUiServer).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
