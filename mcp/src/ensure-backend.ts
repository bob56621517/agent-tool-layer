import { copyFile, readFile as readTextFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const composePath = resolve(here, "../docker/docker-compose.yml");

function timeoutSignal(seconds: number): AbortSignal {
  return AbortSignal.timeout(seconds * 1000);
}

export async function isBackendAvailable(baseUrl = config.toolLayerUrl): Promise<boolean> {
  try {
    const response = await fetch(new URL("/config", baseUrl), {
      signal: timeoutSignal(3),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function readEnvFileSecret(content: string): string {
  const match = /^SEARXNG_SECRET=["']?([^"'\r\n]*)["']?\s*$/m.exec(content);
  return match?.[1]?.trim() || "";
}

async function ensureEnvFile(): Promise<void> {
  const dockerDirectory = dirname(composePath);
  const envPath = resolve(dockerDirectory, ".env");
  const examplePath = resolve(dockerDirectory, ".env.example");

  try {
    const content = await readTextFile(envPath, "utf8");
    if (!config.searxngSecret && !readEnvFileSecret(content)) {
      throw new Error("SEARXNG_SECRET 未配置:请在 docker/.env 填写,或通过 MCP 进程环境变量传入");
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await copyFile(examplePath, envPath);
  const content = await readTextFile(envPath, "utf8");
  if (!config.searxngSecret && !readEnvFileSecret(content)) {
    throw new Error("SEARXNG_SECRET 未配置:请编辑 docker/.env 后重试");
  }
}

async function runComposeUp(): Promise<void> {
  const child = spawn("docker", ["compose", "-f", composePath, "up", "-d"], {
    cwd: dirname(composePath),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", chunk => process.stderr.write(chunk));
  child.stderr?.on("data", chunk => process.stderr.write(chunk));

  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", code => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`docker compose up -d 失败,退出码 ${code}`));
    });
  });
}

export async function ensureBackend(baseUrl = config.toolLayerUrl): Promise<void> {
  if (await isBackendAvailable(baseUrl)) return;

  await ensureEnvFile();
  await runComposeUp();

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (await isBackendAvailable(baseUrl)) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000));
  }
  throw new Error("后台服务启动超时:5 分钟内 :28082/config 未就绪");
}
