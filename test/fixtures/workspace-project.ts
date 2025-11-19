import { createFixtureContext, type ProjectFixture } from "./shared.js";

export type WorkspaceFixture = ProjectFixture;

export async function createWorkspaceFixture(): Promise<ProjectFixture> {
  const { rootDir, writeFile, cleanup } = await createFixtureContext();
  await writeFile("package.json", {
    name: "workspace-root",
    private: true,
    version: "1.0.0",
    workspaces: ["apps/*", "packages/*", "packages/**"],
  });

  await writeFile("tsconfig.json", {
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "~utils": ["packages/utils/src/index.ts"],
        "~utils/*": ["packages/utils/src/*"],
      },
    },
  });

  await writeFile("apps/app-one/package.json", {
    name: "@workspace/app-one",
    version: "1.0.0",
    scripts: {
      lint: "eslint src --max-warnings=0",
      format: "prettier --check src",
      typecheck: "tsc -p tsconfig.json",
    },
    dependencies: {
      "@workspace/ui": "workspace:*",
      "@workspace/utils": "workspace:*",
      "@workspace/platform-core": "workspace:*",
      react: "^18.0.0",
      lodash: "^4.17.21",
    },
    devDependencies: {
      "@types/react": "^18.0.0",
      autoprefixer: "^10.4.0",
      tailwindcss: "^3.4.0",
      typescript: "^5.0.0",
      prettier: "^3.0.0",
      eslint: "^8.57.0",
      "@typescript-eslint/eslint-plugin": "^7.0.0",
      "@typescript-eslint/parser": "^7.0.0",
      vitest: "^1.1.0",
      vite: "^5.0.0",
    },
  });
  await writeFile("apps/app-one/tsconfig.json", {
    extends: "../../tsconfig.json",
  });
  await writeFile(
    "apps/app-one/src/index.ts",
    [
      `import "@workspace/ui";`,
      `import "@workspace/utils";`,
      `import "@workspace/platform-core";`,
      `import "react";`,
      `const dynamicUi = () => import("@workspace/ui");`,
      `const dynamicTailwind = () => import(\`tailwindcss\`);`,
      `const resolvedPrettier = require.resolve("prettier");`,
      `if (typeof jest !== "undefined") {`,
      `  try {`,
      `    jest.requireActual("@workspace/utils");`,
      `  } catch {}`,
      `}`,
      `export const appOne = () => "app-one";`,
    ].join("\n"),
  );
  await writeFile(
    "apps/app-one/tailwind.config.js",
    `module.exports = { content: ["./src/**/*.{ts,tsx}"] };\n`,
  );
  await writeFile(
    "apps/app-one/postcss.config.js",
    `module.exports = { plugins: [require("autoprefixer")] };\n`,
  );
  await writeFile(
    "apps/app-one/.eslintrc.js",
    [
      "module.exports = {",
      "  parser: '@typescript-eslint/parser',",
      "  plugins: ['@typescript-eslint'],",
      "  extends: ['plugin:@typescript-eslint/recommended'],",
      "};\n",
    ].join("\n"),
  );
  await writeFile(
    "apps/app-one/vitest.config.ts",
    [
      "import { defineConfig } from 'vitest/config';",
      "export default defineConfig({ test: { globals: true } });\n",
    ].join("\n"),
  );
  await writeFile(
    "apps/app-one/vite.config.ts",
    [
      "import { defineConfig } from 'vite';",
      "export default defineConfig({});\n",
    ].join("\n"),
  );

  await writeFile("apps/app-two/package.json", {
    name: "@workspace/app-two",
    version: "1.0.0",
    dependencies: {
      "@workspace/ui": "workspace:*",
      react: "^18.0.0",
    },
  });
  await writeFile(
    "apps/app-two/src/index.ts",
    [
      `import "@workspace/ui";`,
      `import "~utils";`,
      `import "react";`,
      `import "axios";`,
      `import fs from "fs";`,
      `export const appTwo = () => "app-two";`,
    ].join("\n"),
  );

  await writeFile("packages/utils/package.json", {
    name: "@workspace/utils",
    version: "1.0.0",
  });
  await writeFile(
    "packages/utils/src/index.ts",
    `export const format = (value: string) => value.toUpperCase();\n`,
  );

  await writeFile("packages/ui/package.json", {
    name: "@workspace/ui",
    version: "1.0.0",
    dependencies: {
      "@workspace/utils": "workspace:*",
    },
  });
  await writeFile(
    "packages/ui/src/index.ts",
    [
      `import { format } from "@workspace/utils";`,
      `export const ui = (value: string) => format(value);`,
    ].join("\n"),
  );
  await writeFile(
    "packages/ui/src/loader.ts",
    [`const util = require("@workspace/utils");`, `export default util;`].join(
      "\n",
    ),
  );

  await writeFile("packages/platform/core/package.json", {
    name: "@workspace/platform-core",
    version: "1.0.0",
    dependencies: {
      "@workspace/platform-gateway": "workspace:*",
    },
  });
  await writeFile(
    "packages/platform/core/src/index.ts",
    [
      `import { gateway } from "@workspace/platform-gateway";`,
      `export const core = () => gateway();`,
    ].join("\n"),
  );

  await writeFile("packages/platform/gateway/package.json", {
    name: "@workspace/platform-gateway",
    version: "1.0.0",
    dependencies: {
      "@workspace/platform-core": "workspace:*",
    },
  });
  await writeFile(
    "packages/platform/gateway/src/index.ts",
    [
      `import { core } from "@workspace/platform-core";`,
      `export const gateway = () => core;`,
    ].join("\n"),
  );

  await writeFile("packages/design-system/package.json", {
    name: "@workspace/design-system",
    version: "1.0.0",
  });
  await writeFile(
    "packages/design-system/src/index.ts",
    `export const designSystem = true;\n`,
  );

  await writeFile("packages/design-system/components/button/package.json", {
    name: "@workspace/design-system-button",
    version: "1.0.0",
  });
  await writeFile(
    "packages/design-system/components/button/src/index.ts",
    `export const Button = () => "button";\n`,
  );

  await writeFile("packages/type-only/package.json", {
    name: "@workspace/type-only",
    version: "1.0.0",
  });
  await writeFile(
    "packages/type-only/src/index.ts",
    [
      `import type { ui } from "@workspace/ui";`,
      `export type { ui };`,
    ].join("\n"),
  );

  return { rootDir, cleanup };
}
