#!/usr/bin/env node
import chalk from "chalk";
import ora from "ora";
import fs from "fs/promises";
import { generateGraph } from "./graph.js";
import { createHtmlTemplate, createJsonReport } from "./utils.js";

type OutputFormat = "html" | "json";

const VALID_FORMATS: OutputFormat[] = ["html", "json"];

interface ParsedArgs {
  rootDir: string;
  outputFile?: string;
  format: OutputFormat;
}

function printBanner() {
  const wordmarkLines = [
    "██████╗ ███████╗████████╗██████╗  █████╗  ██████╗ ███████╗",
    "██╔══██╗██╔════╝╚══██╔══╝██╔══██╗██╔══██╗██╔════╝ ██╔════╝",
    "██████╔╝█████╗     ██║   ██████╔╝███████║██║      █████╗  ",
    "██╔══██╗██╔══╝     ██║   ██╔══██╗██╔══██║██║      ██╔══╝  ",
    "██║  ██║███████╗   ██║   ██║  ██║██║  ██║╚██████╗ ███████╗",
    "╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝",
  ];

  const wordmark = wordmarkLines
    .map((line, idx) =>
      chalk.hex(idx % 2 === 0 ? "#facc15" : "#f97316").bold(line),
    )
    .join("\n");

  const subtitle = chalk.hex("#38bdf8")(
    "Retro monitor for monorepo dependencies",
  );
  const divider = chalk.gray("────────────────────────────────────────────");

  console.log();
  console.log(wordmark);
  console.log(subtitle);
  console.log(divider);
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

function parseCliArgs(argv: string[]): ParsedArgs {
  let format: OutputFormat = "html";
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--json" || arg === "-j") {
      format = "json";
      continue;
    }

    if (arg === "--html") {
      format = "html";
      continue;
    }

    if (arg.startsWith("--format=")) {
      const [, value] = arg.split("=", 2);
      format = normalizeFormat(value, format);
      continue;
    }

    if (arg === "--format" || arg === "-f") {
      const next = argv[i + 1];
      format = normalizeFormat(next, format);
      if (next) i += 1;
      continue;
    }

    if (arg.startsWith("-f") && arg.length > 2) {
      format = normalizeFormat(arg.slice(2), format);
      continue;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  const rootDir = positional[0] || ".";
  const outputFile = positional[1];

  return { rootDir, outputFile, format };
}

function ensureOutputFileName(
  desired: string | undefined,
  format: OutputFormat,
): string {
  const extension = format === "json" ? ".json" : ".retrace.html";

  if (!desired || desired.trim().length === 0) {
    return format === "json" ? `dependencies${extension}` : extension;
  }

  const trimmed = desired.trim();
  const normalized = trimmed.toLowerCase();

  if (format === "json") {
    if (normalized.endsWith(".json")) return trimmed;
    if (normalized.endsWith(".retrace.html")) {
      return trimmed.replace(/\.retrace\.html$/i, ".json");
    }
    return `${trimmed}${extension}`;
  }

  if (normalized.endsWith(".retrace.html")) {
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
  printBanner();

  const parsed = parseCliArgs(process.argv.slice(2));
  const finalOutputFile = ensureOutputFileName(
    parsed.outputFile,
    parsed.format,
  );

  console.log(chalk.gray(`Root directory: ${parsed.rootDir}`));
  console.log(chalk.gray(`Output file: ${finalOutputFile}`));
  console.log(chalk.gray(`Output format: ${parsed.format}\n`));

  const spinner = ora("Generating dependency graph...").start();
  const start = Date.now();

  try {
    const reportData = await generateGraph({
      rootDir: parsed.rootDir,
      onProgress: (msg, progress) => {
        const percentage = progress ? `[${Math.round(progress)}%] ` : "";
        setTimeout(() => {
          spinner.text = chalk.cyan(`${percentage}${msg}`);
        }, 10);
      },
    });

    const outputContent =
      parsed.format === "json"
        ? createJsonReport(reportData)
        : await createHtmlTemplate(reportData, parsed.rootDir);

    await fs.writeFile(finalOutputFile, outputContent, "utf8");

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    const formatLabel = parsed.format.toUpperCase();
    spinner.succeed(
      chalk.green(
        `Report (${chalk.bold(formatLabel)}) written to ${chalk.bold(finalOutputFile)} ${chalk.gray(
          `(${duration}s)`,
        )}`,
      ),
    );
  } catch (err) {
    spinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
})();
