import { vi, beforeEach } from "vitest";

vi.mock("chalk", () => ({
  default: {
    cyan: (s: string) => s,
    magenta: (s: string) => s,
    blue: (s: string) => s,
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    hex: () => {
      const formatter = (s: string) => s;
      formatter.bold = (s: string) => s;
      return formatter;
    },
  },
}));

vi.mock("progress", () => {
  const ProgressBarMock = vi.fn(function () {
    this.tick = vi.fn();
    this.terminate = vi.fn();
  });
  return { default: ProgressBarMock };
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
