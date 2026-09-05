import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { resolveComposePath } from "../src/ensure-backend.js";

let testRoot = "";

beforeAll(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "ensure-backend-"));
  const sourceModuleDirectory = join(testRoot, "dev/mcp/src");
  const builtModuleDirectory = join(testRoot, "build/mcp/dist/mcp");
  await mkdir(dirname(resolve(sourceModuleDirectory, "../../docker/docker-compose.yml")), { recursive: true });
  await mkdir(dirname(resolve(builtModuleDirectory, "../docker/docker-compose.yml")), { recursive: true });
  await writeFile(resolve(sourceModuleDirectory, "../../docker/docker-compose.yml"), "");
  await writeFile(resolve(builtModuleDirectory, "../docker/docker-compose.yml"), "");
});

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe("ensure-backend compose path", () => {
  test("resolves repository docker in development layout", () => {
    const sourceDirectory = join(testRoot, "dev/mcp/src");
    const composePath = resolveComposePath(sourceDirectory);
    const repositoryComposePath = resolve(sourceDirectory, "../../docker/docker-compose.yml");

    expect(composePath).toBe(repositoryComposePath);
  });

  test("resolves bundled docker in build layout", () => {
    const builtDirectory = join(testRoot, "build/mcp/dist/mcp");
    const composePath = resolveComposePath(builtDirectory);
    const bundledComposePath = resolve(builtDirectory, "../docker/docker-compose.yml");

    expect(composePath).toBe(bundledComposePath);
  });
});
