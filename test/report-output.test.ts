import { describe, expect, test, beforeAll, afterAll } from "bun:test";
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
    fixture = await createSimpleProjectFixture();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  test("does not contain TypeScript-only syntax", async () => {
    const { generateDependencyReport } = await import("../src/graph?actual");
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
