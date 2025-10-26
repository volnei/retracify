import fs from "fs/promises";
import path from "path";
import os from "os";

export interface ProjectFixture {
  rootDir: string;
  cleanup: () => Promise<void>;
}

interface FixtureContext extends ProjectFixture {
  writeFile: (relativePath: string, contents: unknown) => Promise<void>;
}

export async function createFixtureContext(
  prefix = "retracify-fixture",
): Promise<FixtureContext> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));

  const writeFile = async (relativePath: string, contents: unknown) => {
    const fullPath = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    if (typeof contents === "string") {
      await fs.writeFile(fullPath, contents, "utf8");
    } else {
      await fs.writeFile(fullPath, JSON.stringify(contents, null, 2), "utf8");
    }
  };

  const cleanup = async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  };

  return { rootDir, writeFile, cleanup };
}
