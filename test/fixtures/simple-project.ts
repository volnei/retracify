import { createFixtureContext, type ProjectFixture } from "./shared.js";

export async function createSimpleProjectFixture(): Promise<ProjectFixture> {
  const { rootDir, writeFile, cleanup } = await createFixtureContext(
    "retracify-simple",
  );

  await writeFile("package.json", {
    name: "simple-app",
    version: "0.1.0",
    description: "Fixture project without workspaces",
    type: "module",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "vitest",
    },
    dependencies: {
      lodash: "^4.17.21",
    },
    devDependencies: {
      typescript: "^5.0.0",
      vitest: "^1.1.0",
    },
  });

  await writeFile("tsconfig.json", {
    compilerOptions: {
      target: "ES2022",
      module: "ES2022",
      moduleResolution: "node16",
      strict: true,
      outDir: "dist",
      esModuleInterop: true,
    },
    include: ["src"],
  });

  await writeFile(
    "src/index.ts",
    [
      `import lodash from "lodash";`,
      `import "axios";`,
      `import { readFileSync } from "fs";`,
      ``,
      `export const sum = (a: number, b: number) => lodash.add(a, b);`,
      `export const loadConfig = () => readFileSync(new URL("./config.json", import.meta.url), "utf8");`,
    ].join("\n"),
  );

  await writeFile("src/config.json", {
    featureFlag: true,
  });

  return { rootDir, cleanup };
}
