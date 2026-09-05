import { cpSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../docker");
const destination = resolve(here, "../dist/docker");

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, {
  recursive: true,
  filter: sourcePath => basename(sourcePath) !== ".env" && !/__pycache__|\.pyc$/.test(sourcePath),
});
