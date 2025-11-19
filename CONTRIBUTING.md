# Contributing to Retracify

Thanks for your interest in improving Retracify! This project thrives on collaboration. The guidelines below outline how to set up your environment, maintain code quality, and submit changes smoothly.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Project Setup](#project-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Updating Builds & Templates](#updating-builds--templates)
- [Pull Request Checklist](#pull-request-checklist)
- [Release Process](#release-process)

## Code of Conduct

Please foster a welcoming, respectful environment. Treat others with empathy, assume positive intent, and take feedback in stride. If problems arise, contact the maintainers privately so we can resolve them quickly.

## Project Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/volnei/retracify.git
   cd retracify
   bun install
   ```

2. **Run the build once**
   ```bash
   bun run build
   ```
   This compiles TypeScript and copies the HTML templates into `dist/`.

3. **Run the tests**
   ```bash
   bun run test
   ```
   Ensuring the suite passes before you start prevents chasing unrelated breakages later.

> **Prerequisites:** Bun ≥ 1.0 (which bundles its own runtime and package manager).

## Development Workflow

- Create a feature branch for every change:
  ```bash
  git checkout -b feat/my-improvement
  ```
- Keep branches focused; prefer several small PRs over one very large change set.
- Reference issues in your commit messages or PR descriptions when applicable.
- Squash or rebase before opening a pull request if your branch history is noisy.
- Use [Conventional Commits](https://www.conventionalcommits.org/) when committing locally (`feat:`, `fix:`, `docs:`, etc.). This keeps release notes tidy.

## Coding Standards

- **TypeScript / JavaScript**
  - Follow the existing code style—use descriptive variable names, avoid unnecessary abstractions, and prefer pure functions when possible.
  - Co-locate helper functions when they are only used in one module.
  - Guard filesystem operations and JSON parsing with try/catch as demonstrated elsewhere in the codebase.

- **Linting & Formatting**
  - `bun run lint` enforces ESLint rules; run `bun run lint:fix` to auto-fix simple issues.
  - `bun run format` applies Prettier formatting to all `src/**/*.ts` files. Use `bun run format:check` in CI or pre-commit hooks.

- **Templates & Styling**
  - Templates live in `templates/` (EJS). Keep Tailwind utility usage consistent, and add comments only when the markup is non-obvious.
  - Avoid inline `<style>` blocks unless a rule cannot be expressed with utilities.

- **Documentation**
  - Update `README.md` and other docs when CLI flags, commands, or workflows change.
  - Keep prose concise and actionable; prioritize how-to steps over high-level marketing copy.

## Testing & Quality Assurance

- `bun run test`: runs the full Bun-powered test matrix (unit + integration).
- `bun run test:unit`: executes the fast unit tests (runs automatically before publish).
- `bun run test:e2e`: focuses on HTML/report integration fixtures.
- `bun run test:watch`: reruns tests on file changes—ideal during feature work.
- `bun run test:coverage`: generates coverage reports when you need deeper insight.
- Add or update tests alongside your code. Missing coverage is a common reason for change requests.
- Keep fixtures small and purpose-built. Use the helpers in `test/fixtures/` to build workspace or single-package scenarios.

## Updating Builds & Templates

- Run `bun run build` before committing if you modify `src/` or `templates/` so the compiled artifacts in `dist/` stay in sync.
- Never edit files under `dist/` directly—they are generated and will be overwritten.
- When you change HTML templates, attach before/after screenshots (or describe the UI impact) in your PR so reviewers can validate visual differences quickly.

## Pull Request Checklist

Before opening a PR:

- [ ] Tests are passing locally (`bun run test`).
- [ ] Lint and format checks pass (`bun run lint`, `bun run format:check` or `bun run format`).
- [ ] `bun run build` has been run if you touched TypeScript or templates.
- [ ] Documentation (README, CLI help output, comments) reflects the new behaviour.
- [ ] Commits follow Conventional Commit style.
- [ ] The PR description summarises the change, links related issues, and calls out any follow-up work.

## Release Process

Maintainers use the scripted release helpers:

```bash
bun run release:patch
bun run release:minor
bun run release:major
```

Each command runs the Bun test matrix and `bun run build` via `prepublishOnly` before publishing to npm. Only maintainers with publish access should execute these commands.

---

Thank you for helping Retracify evolve. If you have questions about these guidelines or need support, open a discussion thread or ping the maintainers in your PR. Happy tracing!
