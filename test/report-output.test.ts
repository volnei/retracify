import { describe, expect, test, beforeAll, afterAll, vi } from "vitest";
import type { ProjectFixture } from "./fixtures/shared";
import { createSimpleProjectFixture } from "./fixtures/simple-project";

const TS_FRAGMENT_PATTERNS = [
  /useRef</,
  /: string/,
  /: number/,
  /: boolean/,
  /: unknown/,
  /: any/,
];

describe("rendered report HTML", () => {
  let fixture: ProjectFixture;

  beforeAll(async () => {
    vi.doUnmock("ts-morph");
    vi.doUnmock("../src/utils");
    vi.doUnmock("../src/graph");
    fixture = await createSimpleProjectFixture();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  test("does not contain TypeScript-only syntax", async () => {
    vi.resetModules();
    const { generateDependencyReport } = await import("../src/graph");
    const { renderHtmlReport } = await import("../src/utils");

    const report = await generateDependencyReport({ rootDir: fixture.rootDir });
    const html = await renderHtmlReport(report, fixture.rootDir);

    const scriptContents = Array.from(
      html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g),
    ).map((match) => match[1]);

    scriptContents.forEach((script) => {
      TS_FRAGMENT_PATTERNS.forEach((pattern) => {
        expect(script).not.toMatch(pattern);
      });
    });
  });
});
