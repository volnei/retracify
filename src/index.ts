#!/usr/bin/env node
import chalk, { type ChalkInstance } from "chalk";
import ora, { type Ora, type Options as OraOptions } from "ora";
import { parseArgs } from "node:util";
import {
  generateDependencyReport as defaultGenerateDependencyReport,
} from "./graph.js";
import { startLiveUiServer as startLiveUiServerImpl } from "./live-server.js";

 type OraFactory = (options?: string | OraOptions) => Ora;

 type RetracifyMocks = {
   startLiveUiServer?: typeof startLiveUiServerImpl;
   ora?: OraFactory;
   chalk?: ChalkInstance;
 };

 const mockContext =
   ((globalThis as unknown as { __retracifyMocks?: RetracifyMocks })
     .__retracifyMocks ?? {}) as RetracifyMocks;

 const startLiveUiServer =
   mockContext.startLiveUiServer ?? startLiveUiServerImpl;
 const oraFactory: OraFactory = mockContext.ora ?? ora;
 const chalkLib: ChalkInstance = mockContext.chalk ?? chalk;

 function renderCliBanner(): void {
   const innerWidth = 84;
   const padCenter = (text: string, width: number) => {
     const trimmed = text.length > width ? text.slice(0, width) : text;
     const padding = Math.max(0, width - trimmed.length);
     const left = Math.floor(padding / 2);
     const right = padding - left;
     return `${" ".repeat(left)}${trimmed}${" ".repeat(right)}`;
   };

   const lines = [
     `┏${"━".repeat(innerWidth)}┓`,
     `┃ ┏${"━".repeat(innerWidth - 4)}┓ ┃`,
     `┃ ┃${padCenter("RETRACIFY", innerWidth - 4)}┃ ┃`,
     `┃ ┃${padCenter("live dependency insights", innerWidth - 4)}┃ ┃`,
     `┃ ┗${"━".repeat(innerWidth - 4)}┛ ┃`,
     `┗${"━".repeat(innerWidth)}┛`,
   ];

   const palette = [
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

   const blend = (start: string, end: string, t: number) => {
     const a = hexToRgb(start);
     const b = hexToRgb(end);
     const clamped = Math.max(0, Math.min(1, t));
     const r = Math.round(a.r + (b.r - a.r) * clamped);
     const g = Math.round(a.g + (b.g - a.g) * clamped);
     const bl = Math.round(a.b + (b.b - a.b) * clamped);
     return rgbToHex(r, g, bl);
   };

   const colorStops = (progress: number) => {
     const segments = palette.length - 1;
     const clamped = Math.max(0, Math.min(1, progress));
     const scaled = clamped * segments;
     const index = Math.min(Math.floor(scaled), segments - 1);
     const localT = scaled - index;
     return blend(palette[index], palette[index + 1], localT);
   };

   console.log();
   lines.forEach((line, rowIdx) => {
     const colored = line
       .split("")
       .map((char, colIdx) => {
         if (char === " ") return " ";
         const diagonalIndex = rowIdx + colIdx;
         const tone = colorStops(diagonalIndex / (lines.length + line.length));
         return chalkLib.hex(tone)(char);
       })
       .join("");
     console.log(colored);
   });
   console.log();
 }

 function renderHelp(): void {
   console.log(`
Usage: retracify [rootDir] [options]

Arguments:
  rootDir                Root directory to analyse (default: current directory)

Options:
  -p, --port <number>    Port for the live dashboard (default: 4173)
      --host <value>     Host/interface to bind (default: 127.0.0.1)
      --no-open          Do not launch a browser automatically
  -h, --help             Show this help message

Examples:
  retracify
  retracify ../workspace --port 4321
  retracify apps/catalog --host 0.0.0.0 --no-open
`);
 }

 (async () => {
   let parsedArgs;
   try {
     parsedArgs = parseArgs({
       args: process.argv.slice(2),
       options: {
         help: { type: "boolean", short: "h" },
         port: { type: "string", short: "p" },
         host: { type: "string" },
         "no-open": { type: "boolean" },
       },
       allowPositionals: true,
       strict: true,
     });
   } catch (error) {
     console.error(chalkLib.red((error as Error).message));
     renderHelp();
     process.exit(1);
     return;
   }

   const { values, positionals } = parsedArgs;

  if (values.help) {
    renderHelp();
    process.exit(0);
    return;
  }

   if (positionals.length > 1) {
     console.error(
       chalkLib.red(
         "Too many positional arguments provided. Expected at most [rootDir].",
       ),
     );
     renderHelp();
     process.exit(1);
   }

   const rootDir = positionals[0] ?? ".";
   const rawPort = values.port ? values.port.trim() : "";
   const host = values.host ? values.host.trim() : "127.0.0.1";
   const autoOpen = !values["no-open"];

   let port = 4173;
   if (rawPort.length > 0) {
     const parsed = Number.parseInt(rawPort, 10);
     if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.error(
        chalkLib.red(
          `Invalid --port value "${rawPort}". Expected an integer between 1 and 65535.`,
        ),
      );
      process.exit(1);
      return;
    }
     port = parsed;
   }

   renderCliBanner();

   console.log(chalkLib.gray(`Root directory: ${rootDir}`));
   console.log(chalkLib.gray(`Host: ${host}`));
   console.log(chalkLib.gray(`Port: ${port}`));
   console.log();

   await startLiveUiServer({
     rootDir,
     port,
     host,
     generateReport: defaultGenerateDependencyReport,
     ora: oraFactory,
     chalk: chalkLib,
     autoOpen,
   });
 })().catch((error: unknown) => {
   console.error(chalkLib.red((error as Error).message));
   process.exit(1);
 });
