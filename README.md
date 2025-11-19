# Retracify

<p align="left">
  <a href="https://github.com/volnei/retracify/actions/workflows/ci.yml">
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/volnei/retracify/ci.yml?branch=main&logo=github&label=CI&style=flat-square">
  </a>
  <a href="https://www.npmjs.com/package/retracify">
    <img alt="npm version" src="https://img.shields.io/npm/v/retracify?color=cb3837&logo=npm&style=flat-square">
  </a>
  <a href="https://www.npmjs.com/package/retracify">
    <img alt="npm downloads" src="https://img.shields.io/npm/dm/retracify?color=cb3837&logo=npm&style=flat-square">
  </a>
  <a href="LICENSE.md">
    <img alt="License" src="https://img.shields.io/github/license/volnei/retracify?style=flat-square">
  </a>
</p>

> Practical dependency intelligence for engineers. Retracify enumerates every package in your monorepo or standalone workspace, maps real import relationships, and hands you artefacts you can drop into reviews, RFCs, or CI without another dashboard subscription.

Explore the GitHub Pages demo: **[retracify.dev ↗](https://volnei.github.io/retracify/)**.

---

## Why engineers reach for Retracify

- **Ground truth imports** – build the graph from actual AST analysis, not package manifests, so every edge is traceable back to a file.
- **Early warning signals** – surface cycles, undeclared dependants, unused installs, and tooling drift before they break builds or reviews.
- **Monorepo fluency** – understands Bun/pnpm/npm/Yarn layouts, `tsconfig` path aliases, and keeps nested workspaces isolated so parent packages stay clean.
- **Automation-friendly output** – the live stream exposes the same payload the frontend consumes, so you can plug it into bots or CI if you need machine-readable insights.
- **Lightweight workflow** – run locally or in CI, keep artefacts next to the repo, and avoid yet another hosted dashboard.

---

## Feature snapshot

| Category | Highlights |
| --- | --- |
| Graph Intelligence | Autodiscovers workspace packages, resolves path aliases, and builds edges from concrete imports. |
| Risk Controls | Flags cycles, undeclared dependants, unused installs, and tooling-only dependencies with evidence. |
| Reporting | Tailwind-powered dashboard delivered over a local live server with a streaming JSON payload. |
| Developer Experience | Single binary/CLI, progress callbacks, sensible defaults, and no background agents or services. |

---

## Quickstart

```bash
# Install for your workspace
bun add -d retracify

# Or run instantly with npx
npx retracify
```

### CLI usage

```bash
npx retracify [rootDir] [options]
```

- `rootDir` – root directory to analyse (defaults to `.`)
- `--port <number>` – port exposed by the live dashboard (default `4173`)
- `--host <value>` – interface to bind (default `127.0.0.1`)
- `--no-open` – skip automatically opening the browser

#### Common playbooks

```bash
# Launch the live dashboard for the current repo
npx retracify

# Watch a sibling workspace
npx retracify ../workspace --port 4321

# Host on all interfaces for shared demos
npx retracify apps/catalog --host 0.0.0.0 --no-open
```

---

## Reports that engineers actually use

### Live dashboard

- Switch between list and block views depending on whether you need a high-level sweep or a dependency deep dive.
- Package cards expose declared vs. undeclared edges, external footprint, and cycle membership at a glance.
- Keyboard-friendly navigation, accessible colours, and a dark theme tuned for late-night debugging.
- Incremental analysis keeps refreshes fast: only the files that changed are re-parsed before the dashboard updates.

---

## Build with confidence

```bash
bun install         # bootstrap dependencies
bun run build       # compile ESM + copy production templates
bun run test        # run full Bun test matrix (unit + integration)
bun run lint        # TypeScript-aware linting
bun run start ./repo   # live-run against a target workspace
```

Regression coverage currently locks down:

- Nested workspace detection and per-package file counting.
- Scoped import resolution like `@scope/app/ui/button`.
- CLI behaviours for progress reporting and live dashboard lifecycle.

Planning to tweak the artefacts? Templates live in `templates/` and copy to `dist/templates` during `build`. Drop a `templates/report.ejs` in your repo to override branding without forking.

---

## Contribute

Retracify is built by engineers who use it. Contributions that improve accuracy,
clarity, or developer workflow are always welcome.

1. Fork and branch from `main`.
2. Add or update tests alongside your changes.
3. Run `bun run lint`, `bun run test`, and `bun run build`.
4. Open a PR with a Conventional Commit subject (`feat: expose package metrics`).
5. Include before/after screenshots for template work whenever possible.

Check the full [CONTRIBUTING.md](CONTRIBUTING.md) guide for deeper expectations.

---

## License

Released under the MIT License. See [`LICENSE.md`](LICENSE.md) for details.
