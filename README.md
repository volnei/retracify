# Retracify

<p align="left">
  <a href="https://github.com/volnei/retracify/actions/workflows/ci.yml">
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/volnei/retracify/ci.yml?branch=main&logo=github&label=CI&style=flat-square">
  </a>
  <a href="https://codecov.io/github/volnei/retracify">
    <img alt="Coverage" src="https://img.shields.io/codecov/c/github/volnei/retracify?logo=codecov&style=flat-square">
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
- **Monorepo fluency** – understands pnpm/npm/Yarn layouts, `tsconfig` path aliases, and keeps nested workspaces isolated so parent packages stay clean.
- **Automation-friendly output** – emit JSON that mirrors the HTML payload so bots, CI, and scripts consume the same facts engineers see.
- **Lightweight workflow** – run locally or in CI, keep artefacts next to the repo, and avoid yet another hosted dashboard.

---

## Feature snapshot

| Category | Highlights |
| --- | --- |
| Graph Intelligence | Autodiscovers workspace packages, resolves path aliases, and builds edges from concrete imports. |
| Risk Controls | Flags cycles, undeclared dependants, unused installs, and tooling-only dependencies with evidence. |
| Reporting | Tailwind-powered HTML dashboard plus JSON serialisation using the identical schema consumed by the UI. |
| Developer Experience | Single binary/CLI, progress callbacks, sensible defaults, and no background agents or services. |

---

## Quickstart

```bash
# Install for your workspace
pnpm add -D retracify

# Or run instantly with npx
npx retracify .
```

### Binary usage

```bash
npx retracify [rootDir] [outputFile] [format]
```

- `rootDir` – root directory to analyse (defaults to `.`).
- `outputFile` – file name for the rendered report. Omit to use `.retracify.html` (HTML) or `dependencies.json` (JSON).
- `format` – choose `html`, `json`, `--html`, `--json`, or `--format <value>`.

#### Common playbooks

```bash
# Generate the HTML dashboard for the current repo
npx retracify .

# Produce JSON telemetry for CI audits
npx retracify . report.json --json

# Use the local/global binary
retracify ./apps/catalog analytics.retracify.html
```

### Sample report

- [HTML example](https://volnei.github.io/retracify/sample-report.retracify.html) — generated from this repository to showcase the default dashboard styling and metadata.

---

## Reports that engineers actually use

### HTML dashboard

- Switch between list and block views depending on whether you need a high-level sweep or deep dive.
- Package cards expose declared vs. undeclared edges, external footprint, and cycle membership at a glance.
- Keyboard-friendly navigation, accessible colours, and a dark theme tuned for late-night debugging.

### JSON export

- Mirrors the HTML contract (`packages`, `edges`, `cyclicDeps`, `externalDependencies`, etc.).
- Feed the output straight into CI, bots, or a lightweight scorecard without fiddling with undocumented schemas.

---

## Build with confidence

```bash
pnpm install        # bootstrap dependencies
pnpm build          # compile ESM + copy production templates
pnpm test           # comprehensive Vitest suite (unit + integration)
pnpm lint           # TypeScript-aware linting
pnpm start ./repo   # live-run against a target workspace
```

Regression coverage currently locks down:

- Nested workspace detection and per-package file counting.
- Scoped import resolution like `@scope/app/ui/button`.
- CLI behaviours for progress reporting plus HTML/JSON output paths.

Planning to tweak the artefacts? Templates live in `templates/` and copy to `dist/templates` during `build`. Drop a `templates/report.ejs` in your repo to override branding without forking.

---

## Contribute

Retracify is built by engineers who use it. Contributions that improve accuracy,
clarity, or developer workflow are always welcome.

1. Fork and branch from `main`.
2. Add or update tests alongside your changes.
3. Run `pnpm lint`, `pnpm test`, and `pnpm build`.
4. Open a PR with a Conventional Commit subject (`feat: expose package metrics`).
5. Include before/after screenshots for template work whenever possible.

Check the full [CONTRIBUTING.md](CONTRIBUTING.md) guide for deeper expectations.

---

## License

Released under the MIT License. See [`LICENSE.md`](LICENSE.md) for details.
