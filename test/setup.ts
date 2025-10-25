import { vi, beforeEach } from "vitest";

vi.mock("chalk", () => ({
  default: {
    cyan: (s: string) => s,
    magenta: (s: string) => s,
    blue: (s: string) => s,
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    hex: () => ({
      bold: (s: string) => s,
    }),
  },
}));

vi.mock("progress", () => {
  const ProgressBarMock = vi.fn(function () {
    this.tick = vi.fn();
    this.terminate = vi.fn();
  });
  return { default: ProgressBarMock };
});

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
}));

vi.mock("path", () => {
  const mockPath = {
    resolve: (...args: string[]) =>
      `/mocked/${args.join("/")}`.replace(/\/+/g, "/"),
    dirname: (p: string) => p.split("/").slice(0, -1).join("/") || "/",
    basename: (p: string) => p.split("/").pop() || "",
    relative: (from: string, to: string) => {
      if (!to.startsWith(from)) {
        return `../${to.replace(/^\/+/, "")}`;
      }
      const suffix = to.slice(from.length);
      return suffix.startsWith("/") ? suffix.slice(1) : suffix;
    },
    isAbsolute: (p: string) => p.startsWith("/"),
  };
  return { ...mockPath, default: mockPath };
});

vi.mock("fs/promises", () => {
  const fsMock = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
  return { ...fsMock, default: fsMock };
});

vi.mock("ts-morph", () => ({
  Project: vi.fn(function () {
    this.addSourceFileAtPath = vi.fn().mockReturnValue({
      getImportDeclarations: vi.fn(() => []),
      getDescendantsOfKind: vi.fn(() => []),
    });
  }),
  SyntaxKind: {
    CallExpression: 1,
    Identifier: 2,
    StringLiteral: 3,
    ImportKeyword: 4,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});
