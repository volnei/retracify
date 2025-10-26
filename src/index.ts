#!/usr/bin/env node
import chalk from "chalk";
import ora from "ora";
import fs from "fs/promises";
import { parseArgs } from "node:util";
import { generateDependencyReport } from "./graph.js";
import { renderHtmlReport, serializeReportToJson } from "./utils.js";

type OutputFormat = "html" | "json";

const VALID_FORMATS: OutputFormat[] = ["html", "json"];

// Keep some personality in the CLI before work begins.
function renderCliBanner() {
  const innerWidth = 96;
  const padCenter = (text: string, width: number) => {
    const trimmed = text.length > width ? text.slice(0, width) : text;
    const padding = Math.max(0, width - trimmed.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return `${" ".repeat(left)}${trimmed}${" ".repeat(right)}`;
  };

  const lines = [
    `┏${"━".repeat(innerWidth)}┓`,
    `┃┌${"─".repeat(innerWidth - 2)}┐┃`,
    `┃│${padCenter("RETRACIFY", innerWidth - 2)}│┃`,
    `┃│${padCenter("dependency graphs made simple", innerWidth - 2)}│┃`,
    `┃└${"─".repeat(innerWidth - 2)}┘┃`,
    `┗${"━".repeat(innerWidth)}┛`,
  ];

  const gradientStops = [
    "#f97316",
    "#fbbf24",
    "#22d3ee",
    "#a855f7",
    "#ec4899",
    "#f97316",
  ];

  const hexToRgb = (hex: string) => {
    const normalized = hex.replace("#", "");
    const bigint = parseInt(normalized, 16);
    return {
      r: (bigint >> 16) & 255,
      g: (bigint >> 8) & 255,
      b: bigint & 255,
    };
  };

  const rgbToHex = (r: number, g: number, b: number) =>
    `#${[r, g, b]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;

  const mixColors = (start: string, end: string, fraction: number) => {
    const a = hexToRgb(start);
    const b = hexToRgb(end);
    const clamp = Math.max(0, Math.min(1, fraction));
    const r = Math.round(a.r + (b.r - a.r) * clamp);
    const g = Math.round(a.g + (b.g - a.g) * clamp);
    const bl = Math.round(a.b + (b.b - a.b) * clamp);
    return rgbToHex(r, g, bl);
  };

  const gradientColorAt = (progress: number) => {
    const steps = gradientStops.length - 1;
    const clamped = Math.max(0, Math.min(1, progress));
    const scaled = clamped * steps;
    const index = Math.min(Math.floor(scaled), steps - 1);
    const localT = scaled - index;
    return mixColors(gradientStops[index], gradientStops[index + 1], localT);
  };

  const textRows = new Set([2, 3]);

  const colorized = lines.map((line, rowIdx) =>
    line
      .split("")
      .map((char, colIdx) => {
        if (char === " ") return " ";
        const diagonalIndex = rowIdx + colIdx;
        const maxSpan = lines.length + line.length;
        const tone = gradientColorAt(diagonalIndex / maxSpan);
        const insideText =
          textRows.has(rowIdx) && colIdx > 2 && colIdx < line.length - 3;

        if (insideText && /\S/.test(char)) {
          return chalk.hex("#f8fafc").bold(char);
        }

        return chalk.hex(tone)(char);
      })
      .join(""),
  );

  console.log();
  colorized.forEach((line) => console.log(line));
  console.log();
}

function normalizeFormat(
  value: string | undefined,
  fallback: OutputFormat,
): OutputFormat {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  return VALID_FORMATS.includes(normalized as OutputFormat)
    ? (normalized as OutputFormat)
    : fallback;
}

function renderHelp(): void {
  console.log(`
Usage: retracify [rootDir] [outputFile] [options]

Arguments:
  rootDir       Root directory to analyse (default: current directory)
  outputFile    Optional output filename (extension adjusted automatically)

Options:
  -f, --format <html|json>  Select output format (default: html)
      --html                Shortcut for --format html
  -j, --json                Shortcut for --format json
  -h, --help                Show this help message

Examples:
  retracify ./apps ./report.html
  retracify --json
`);
}

function resolveOutputFilename(
  desired: string | undefined,
  format: OutputFormat,
): string {
  const extension = format === "json" ? ".json" : ".retracify.html";

  if (!desired || desired.trim().length === 0) {
    return format === "json" ? `dependencies${extension}` : extension;
  }

  const trimmed = desired.trim();
  const normalized = trimmed.toLowerCase();

  if (format === "json") {
    if (normalized.endsWith(".json")) return trimmed;
    if (normalized.endsWith(".retracify.html")) {
      return trimmed.replace(/\.retracify\.html$/i, ".json");
    }
    return `${trimmed}${extension}`;
  }

  if (normalized.endsWith(".retracify.html")) {
    return trimmed;
  }

  if (normalized.endsWith(".html")) {
    return trimmed.replace(/\.html$/i, extension);
  }

  if (normalized.endsWith(".json")) {
    return trimmed.replace(/\.json$/i, extension);
  }

  return `${trimmed}${extension}`;
}

(async () => {
  let parsedArgs;
  try {
    parsedArgs = parseArgs({
      args: process.argv.slice(2),
      options: {
        format: { type: "string", short: "f" },
        html: { type: "boolean" },
        json: { type: "boolean", short: "j" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    renderHelp();
    process.exit(1);
  }

  const { values, positionals } = parsedArgs;

  if (values.help) {
    renderHelp();
    process.exit(0);
  }

  if (positionals.length > 2) {
    console.error(
      chalk.red(
        "Too many positional arguments provided. Expected at most [rootDir] [outputFile].",
      ),
    );
    renderHelp();
    process.exit(1);
  }

  let requestedFormat: string | undefined = values.format;
  if (values.html) requestedFormat = "html";
  if (values.json) requestedFormat = "json";

  const normalizedFormat = normalizeFormat(
    requestedFormat,
    values.json ? "json" : "html",
  );

  if (requestedFormat && normalizedFormat !== requestedFormat.toLowerCase()) {
    console.error(
      chalk.red(
        `Invalid format "${requestedFormat}". Supported formats: ${VALID_FORMATS.join(", ")}.`,
      ),
    );
    renderHelp();
    process.exit(1);
  }

  const rootDir = positionals[0] ?? ".";
  const outputFile = positionals[1];

  renderCliBanner();

  const finalOutputFile = resolveOutputFilename(outputFile, normalizedFormat);

  console.log(chalk.gray(`Root directory: ${rootDir}`));
  console.log(chalk.gray(`Output file: ${finalOutputFile}`));
  console.log(chalk.gray(`Output format: ${normalizedFormat}\n`));

  // Show progressive feedback while the report is assembled.
  const spinner = ora("Generating dependency graph...").start();
  const start = Date.now();

  try {
    const reportData = await generateDependencyReport({
      rootDir,
      onProgress: (msg, progress) => {
        const percentage = progress ? `[${Math.round(progress)}%] ` : "";
        setTimeout(() => {
          spinner.text = chalk.cyan(`${percentage}${msg}`);
        }, 10);
      },
    });

    const outputContent =
      normalizedFormat === "json"
        ? serializeReportToJson(reportData)
        : await renderHtmlReport(reportData, rootDir);

    await fs.writeFile(finalOutputFile, outputContent, "utf8");

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    const formatLabel = normalizedFormat.toUpperCase();
    spinner.succeed(
      chalk.green(
        `Report (${chalk.bold(formatLabel)}) written to ${chalk.bold(finalOutputFile)} ${chalk.gray(
          `(${duration}s)`,
        )}`,
      ),
    );

    const packages = reportData.packages;
    if (packages.length > 0) {
      const packagesWithIssues = packages.filter((pkg) => {
        const undeclared = (pkg.undeclaredDeps?.length ?? 0) > 0;
        const external = (pkg.undeclaredExternalDeps?.length ?? 0) > 0;
        const unused = (pkg.unusedExternalDeps?.length ?? 0) > 0;
        return undeclared || external || unused;
      }).length;
      const runtimeExternalCount = packages.reduce((acc, pkg) => {
        return (
          acc +
          (pkg.externalDependencies || []).filter(
            (dep) => !dep.isToolingOnly && !dep.isLikelyTypePackage,
          ).length
        );
      }, 0);
      const toolingExternalCount = packages.reduce((acc, pkg) => {
        return (
          acc +
          (pkg.externalDependencies || []).filter((dep) => dep.isToolingOnly)
            .length
        );
      }, 0);
      const typeExternalCount = packages.reduce((acc, pkg) => {
        return (
          acc +
          (pkg.externalDependencies || []).filter(
            (dep) => dep.isLikelyTypePackage,
          ).length
        );
      }, 0);
      const toolingDepsCount = packages.reduce(
        (acc, pkg) => acc + (pkg.toolingDeps?.length ?? 0),
        0,
      );
      const averageInternalDeps = (
        packages.reduce((acc, pkg) => acc + pkg.dependencies.length, 0) /
        packages.length
      ).toFixed(1);

      console.log();
      console.log(
        chalk.gray(
          `Packages: ${chalk.white(packages.length)} (needs attention: ${chalk.yellow(packagesWithIssues)})`,
        ),
      );
      console.log(
        chalk.gray(
          `Internal deps: avg ${chalk.white(averageInternalDeps)} • runtime externals: ${chalk.white(runtimeExternalCount)} • tooling: ${chalk.white(toolingExternalCount)} • types: ${chalk.white(typeExternalCount)}`,
        ),
      );
      console.log(
        chalk.gray(
          `Tooling references detected: ${chalk.white(toolingDepsCount)}`,
        ),
      );
    }
  } catch (err) {
    spinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
})();
