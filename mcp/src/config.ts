function integerFromEnv(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) return fallback;
  return Math.floor(parsed);
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const config = {
  toolLayerUrl: withoutTrailingSlash(process.env.TOOL_LAYER_URL || "http://localhost:28082"),
  readTimeout: integerFromEnv("READ_TIMEOUT", 90, 600),
  readLength: integerFromEnv("READ_LENGTH", 5000, 50000),
  bochaApiKey: process.env.BOCHA_API_KEY || "",
  searxngSecret: process.env.SEARXNG_SECRET || "",
  githubToken: process.env.GITHUB_TOKEN || "",
};
