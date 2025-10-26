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
   pnpm install
   ```

2. **Run the build once**
   ```bash
   pnpm build
   ```
   This compiles TypeScript and copies the HTML templates into `dist/`.

3. **Run the tests**
   ```bash
   pnpm test
   ```
   Ensuring the suite passes before you start prevents chasing unrelated breakages later.

> **Prerequisites:** Node.js ≥ 18 and [pnpm](https://pnpm.io/) must be installed globally.

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
  - `pnpm lint` enforces ESLint rules; run `pnpm lint:fix` to auto-fix simple issues.
  - `pnpm format` applies Prettier formatting to all `src/**/*.ts` files. Use `pnpm format:check` in CI or pre-commit hooks.

- **Templates & Styling**
  - Templates live in `templates/` (EJS). Keep Tailwind utility usage consistent, and add comments only when the markup is non-obvious.
  - Avoid inline `<style>` blocks unless a rule cannot be expressed with utilities.

- **Documentation**
  - Update `README.md` and other docs when CLI flags, commands, or workflows change.
  - Keep prose concise and actionable; prioritize how-to steps over high-level marketing copy.

## Testing & Quality Assurance

- `pnpm test`: runs the full Vitest suite once (unit + integration).
- `pnpm test:watch`: reruns tests on file changes—ideal during feature work.
- `pnpm test:coverage`: generates coverage reports when you need deeper insight.
- Add or update tests alongside your code. Missing coverage is a common reason for change requests.
- Keep fixtures small and purpose-built. Use the helpers in `test/fixtures/` to build workspace or single-package scenarios.

## Updating Builds & Templates

- Run `pnpm build` before committing if you modify `src/` or `templates/` so the compiled artifacts in `dist/` stay in sync.
- Never edit files under `dist/` directly—they are generated and will be overwritten.
- When you change HTML templates, attach before/after screenshots (or describe the UI impact) in your PR so reviewers can validate visual differences quickly.

## Pull Request Checklist

Before opening a PR:

- [ ] Tests are passing locally (`pnpm test`).
- [ ] Lint and format checks pass (`pnpm lint`, `pnpm format:check` or `pnpm format`).
- [ ] `pnpm build` has been run if you touched TypeScript or templates.
- [ ] Documentation (README, CLI help output, comments) reflects the new behaviour.
- [ ] Commits follow Conventional Commit style.
- [ ] The PR description summarises the change, links related issues, and calls out any follow-up work.

## Release Process

Maintainers use pnpm’s version helpers and the scripted publish commands:

```bash
pnpm run release:patch
pnpm run release:minor
pnpm run release:major
```

Each command runs the test suite and build (`prepublishOnly`) before publishing to npm. Only maintainers with publish access should execute these commands.

---

Thank you for helping Retracify evolve. If you have questions about these guidelines or need support, open a discussion thread or ping the maintainers in your PR. Happy tracing!
