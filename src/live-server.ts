import http from "http";
import path from "path";
import type { FSWatcher, Stats } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { watch } from "node:fs";
import open from "open";
import type { ChalkInstance } from "chalk";
import type { Ora, Options as OraOptions } from "ora";
import {
  IncrementalDependencyReportBuilder,
  generateDependencyReport as defaultGenerateDependencyReport,
} from "./graph.js";
import type {
  DependencyReport,
  GenerateReportSnapshotEvent,
} from "./types.js";
import {
  buildClientViewModel,
  renderHtmlReport,
  type BuildClientViewModelResult,
  type ReportClientPayload,
} from "./utils.js";

type GenerateDependencyReport = typeof defaultGenerateDependencyReport;
export type OraFactory = (options?: string | OraOptions) => Ora;

type LiveEvent =
  | {
      type: "report";
      payload: ReportClientPayload;
      meta?: { message?: string; progress?: number };
    }
  | {
      type: "progress";
      status: { message: string; progress?: number };
    };

async function launchBrowser(target: string): Promise<boolean> {
  try {
    await open(target);
    return true;
  } catch {
    return false;
  }
}

export interface StartLiveUiServerOptions {
  rootDir: string;
  port: number;
  host?: string;
  generateReport: GenerateDependencyReport;
  ora: OraFactory;
  chalk: ChalkInstance;
  autoOpen?: boolean;
}

export async function startLiveUiServer({
  rootDir,
  port,
  host = "127.0.0.1",
  generateReport,
  ora,
  chalk,
  autoOpen = true,
}: StartLiveUiServerOptions): Promise<void> {
  const normalizedRoot = path.resolve(rootDir);
  const canUseBuilder =
    generateReport === defaultGenerateDependencyReport;
  const pendingFileChanges = new Set<string>();
  let builder: IncrementalDependencyReportBuilder | null = null;
  const clients = new Set<http.ServerResponse>();
  let latestView: BuildClientViewModelResult | null = null;
  let latestPayload: ReportClientPayload | null = null;
  let latestHtml = "";
  let latestStatus: { message: string; progress?: number } | null = null;
  const watchers = new Map<string, FSWatcher>();
  let pollingTimer: NodeJS.Timeout | null = null;
  let rebuilding = false;
  let rebuildRequested = false;
  let pendingReason: string | null = null;

  const fallbackReport = { rootDir: normalizedRoot, packages: [] };
  latestView = buildClientViewModel(fallbackReport);
  latestPayload = latestView.payload;
  latestHtml = await renderHtmlReport(fallbackReport, normalizedRoot, {
    liveMode: true,
    viewModel: latestView,
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    if (url.pathname === "/events") {
      handleSse(res, clients, latestPayload, latestStatus);
      return;
    }

    if (url.pathname === "/report.json") {
      if (!latestPayload) {
        res.writeHead(204).end();
        return;
      }
      res
        .writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-cache",
        })
        .end(JSON.stringify(latestPayload));
      return;
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }

    res
      .writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end(latestHtml);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const displayHost = host === "127.0.0.1" ? "localhost" : host;
  const serverUrl = `http://${displayHost}:${port}`;
  console.log(chalk.gray(`Live report available at ${chalk.bold(serverUrl)}`));

  if (autoOpen) {
    void (async () => {
      const opened = await launchBrowser(serverUrl);
      if (!opened) {
        console.warn(
          chalk.yellow(
            `Unable to automatically open your browser. Visit ${chalk.bold(serverUrl)} to view the report.`,
          ),
        );
      }
    })();
  }

  const scheduleProgressBroadcast = (message: string, progress?: number) => {
    latestStatus = { message, progress };
    broadcastEvent({ type: "progress", status: latestStatus }, clients);
  };

  const recordFileChange = (target: string) => {
    if (!target) return;
    const absolute = path.isAbsolute(target)
      ? target
      : path.resolve(normalizedRoot, target);
    pendingFileChanges.add(absolute);
  };

  const consumePendingChanges = (): string[] => {
    const entries = Array.from(pendingFileChanges);
    pendingFileChanges.clear();
    return entries;
  };

  const runReportCycle = async (reason: string) => {
    rebuilding = true;
    rebuildRequested = false;
    pendingReason = null;

    const changedFiles = consumePendingChanges();

    const spinnerLabel =
      reason.trim().length > 0
        ? `Refreshing report (${reason})...`
        : "Refreshing report...";
    const spinner = ora(spinnerLabel).start();
    scheduleProgressBroadcast(spinnerLabel);

    let lastProgressBroadcast = 0;

    const handleProgress = (msg: string, progress?: number) => {
      const prefix = progress ? `[${Math.round(progress)}%] ` : "";
      spinner.text = chalk.cyan(`${prefix}${msg}`);
      const now = Date.now();
      if (now - lastProgressBroadcast > 200) {
        scheduleProgressBroadcast(msg, progress);
        lastProgressBroadcast = now;
      }
    };

    const handleSnapshot = (event: GenerateReportSnapshotEvent) => {
      latestView = buildClientViewModel(event.report);
      latestPayload = latestView.payload;
      latestStatus = { message: event.message, progress: event.progress };
      broadcastEvent(
        {
          type: "report",
          payload: latestPayload,
          meta: latestStatus ?? undefined,
        },
        clients,
      );
    };

    try {
      let report: DependencyReport;
      if (canUseBuilder) {
        if (!builder) {
          builder = new IncrementalDependencyReportBuilder({
            rootDir: normalizedRoot,
          });
        }
        report = await builder.buildReport({
          changedFiles,
          onProgress: handleProgress,
          onSnapshot: handleSnapshot,
        });
      } else {
        report = await generateReport({
          rootDir: normalizedRoot,
          onProgress: handleProgress,
          onSnapshot: handleSnapshot,
        });
      }

      latestView = buildClientViewModel(report);
      latestPayload = latestView.payload;

      latestHtml = await renderHtmlReport(report, normalizedRoot, {
        liveMode: true,
        viewModel: latestView,
      });

      const completionMessage = `Report updated ${chalk.gray(
        `@ ${new Date().toLocaleTimeString()}`,
      )}`;
      spinner.succeed(chalk.green(completionMessage));
      scheduleProgressBroadcast(`Synced at ${new Date().toLocaleTimeString()}`);

      broadcastEvent(
        {
          type: "report",
          payload: latestPayload,
          meta: latestStatus ?? undefined,
        },
        clients,
      );
    } catch (error) {
      const message = (error as Error).message;
      spinner.fail(chalk.red(message));
      scheduleProgressBroadcast(`Failed: ${message}`);
    } finally {
      rebuilding = false;
      if (rebuildRequested) {
        const followUpReason = pendingReason ?? "change detected";
        rebuildRequested = false;
        pendingReason = null;
        void runReportCycle(followUpReason);
      }
    }
  };

  const scheduleRefresh = (reason: string, changedPath?: string) => {
    pendingReason = reason;
    if (changedPath) recordFileChange(changedPath);
    scheduleProgressBroadcast(`Change detected: ${reason}`);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      requestRebuild(reason);
    }, 200);
  };

  let debounceTimer: NodeJS.Timeout | null = null;

  const requestRebuild = (reason: string) => {
    if (rebuilding) {
      rebuildRequested = true;
      pendingReason = reason;
      return;
    }
    void runReportCycle(reason);
  };

  const ignoredNames = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    ".turbo",
    ".next",
    "coverage",
    ".cache",
    ".idea",
  ]);

  const shouldIgnore = (targetPath: string): boolean => {
    const relative = path.relative(normalizedRoot, targetPath);
    if (relative.startsWith("..")) return true;
    const segments = relative.split(path.sep).filter(Boolean);
    return segments.some((segment) => ignoredNames.has(segment));
  };

  const removeWatchersUnder = (dir: string) => {
    const resolved = path.resolve(dir);
    for (const [watchedDir, watcher] of watchers.entries()) {
      if (
        watchedDir === resolved ||
        watchedDir.startsWith(`${resolved}${path.sep}`)
      ) {
        try {
          watcher.close();
        } catch {
          // ignore
        }
        watchers.delete(watchedDir);
      }
    }
  };

  const handleWatcherError =
    (dir: string) => (error: NodeJS.ErrnoException | Error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES") {
        removeWatchersUnder(dir);
      }
    };

  const activatePollingFallback = () => {
    if (pollingTimer) return;
    pollingTimer = setInterval(() => {
      scheduleRefresh("workspace poll");
    }, 10000);
    console.log(
      chalk.yellow(
        "Watcher limit exceeded or unsupported platform detected. Falling back to 10s polling.",
      ),
    );
  };

  const registerWatcher = (dir: string) => {
    const resolvedDir = path.resolve(dir);
    if (watchers.has(resolvedDir) || shouldIgnore(resolvedDir)) return;
    try {
      const watcher = watch(
        resolvedDir,
        (eventType, fileName: string | Buffer | null) => {
          const name =
            typeof fileName === "string"
              ? fileName
              : fileName
                ? fileName.toString()
                : undefined;
          const target = name ? path.join(resolvedDir, name) : resolvedDir;
          if (shouldIgnore(target)) return;
          scheduleRefresh(relativePath(target, normalizedRoot), target);
          if (eventType === "rename" && name) {
            enqueueDirectoryScan(target);
          }
        },
      );
      watcher.on("error", handleWatcherError(resolvedDir));
      watchers.set(resolvedDir, watcher);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOSPC") {
        activatePollingFallback();
      }
    }
  };

  const walkAndWatch = async (entry: string): Promise<void> => {
    const stack = [path.resolve(entry)];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (shouldIgnore(current)) continue;
      let stats: Stats;
      try {
        stats = await fsPromises.stat(current);
      } catch {
        continue;
      }
      if (!stats.isDirectory()) continue;
      registerWatcher(current);
      let entries;
      try {
        entries = await fsPromises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of entries) {
        if (dirent.isDirectory()) {
          stack.push(path.join(current, dirent.name));
        }
      }
    }
  };

  const enqueueDirectoryScan = (dir: string) => {
    const resolved = path.resolve(dir);
    if (shouldIgnore(resolved)) return;
    void (async () => {
      try {
        const stats = await fsPromises.stat(resolved);
        if (stats.isDirectory()) {
          await walkAndWatch(resolved);
        }
      } catch {
        removeWatchersUnder(resolved);
      }
    })();
  };

  const bootstrapWatchers = async () => {
    try {
      const recursiveWatcher = watch(
        normalizedRoot,
        { recursive: true },
        (eventType, fileName: string | Buffer | null) => {
          const name =
            typeof fileName === "string"
              ? fileName
              : fileName
                ? fileName.toString()
                : undefined;
          const target = name
            ? path.join(normalizedRoot, name)
            : normalizedRoot;
          if (shouldIgnore(target)) return;
          scheduleRefresh(relativePath(target, normalizedRoot), target);
          if (eventType === "rename" && name) {
            enqueueDirectoryScan(path.join(normalizedRoot, name));
          }
        },
      );
      recursiveWatcher.on("error", handleWatcherError(normalizedRoot));
      watchers.set(normalizedRoot, recursiveWatcher);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code && err.code !== "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") {
        if (err.code === "ENOSPC") {
          activatePollingFallback();
          return;
        }
        throw err;
      }
    }

    await walkAndWatch(normalizedRoot);
  };

  try {
    await bootstrapWatchers();
    if (watchers.size === 0 && !pollingTimer) {
      activatePollingFallback();
    }
  } catch (error) {
    console.error(
      chalk.red(
        `Failed to initialise file watchers: ${(error as Error).message}. Falling back to polling.`,
      ),
    );
    activatePollingFallback();
  }

  void runReportCycle("initial scan");

  const shutdown = () => {
    for (const watcher of watchers.values()) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    watchers.clear();
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    for (const client of clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    server.close(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await new Promise<void>(() => {
    // Keep process alive
  });
}

function handleSse(
  res: http.ServerResponse,
  clients: Set<http.ServerResponse>,
  payload: ReportClientPayload | null,
  status: { message: string; progress?: number } | null,
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");
  if (status) {
    res.write(`data: ${JSON.stringify({ type: "progress", status })}\n\n`);
  }
  if (payload) {
    res.write(
      `data: ${JSON.stringify({
        type: "report",
        payload,
        meta: status ?? undefined,
      })}\n\n`,
    );
  }
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
  });
}

function broadcastEvent(event: LiveEvent, clients: Set<http.ServerResponse>) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
  }
}

function relativePath(filePath: string, rootDir: string): string {
  const relative = path.relative(rootDir, filePath);
  return relative.startsWith("..") ? path.basename(filePath) : relative;
}
