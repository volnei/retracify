import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { createWorkspaceFixture } from "../test/fixtures/workspace-project";
import type { ProjectFixture } from "../test/fixtures/shared";
import { generateDependencyReport } from "../src/graph";
import { renderHtmlReport } from "../src/utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const docsDir = path.resolve(repoRoot, "docs");
const outputPath = path.resolve(docsDir, "sample-report.retracify.html");

async function main(): Promise<void> {
  let fixture: ProjectFixture | null = null;
  try {
    fixture = await createWorkspaceFixture();
    const report = await generateDependencyReport({ rootDir: fixture.rootDir });

    const displayRoot = "retracify-fixtures/workspace";
    const sanitizedReport = {
      ...report,
      rootDir: displayRoot,
    };

    const html = await renderHtmlReport(sanitizedReport, repoRoot);
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(outputPath, html, "utf8");
    console.log(
      `Sample report generated at ${path.relative(repoRoot, outputPath)}`,
    );
  } finally {
    await fixture?.cleanup();
  }
}

main().catch((error) => {
  console.error("Failed to update sample report:", error);
  process.exit(1);
});
