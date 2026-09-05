import { sliceText } from "../slice.js";

export type FetchUrlOptions = {
  baseUrl: string;
  url: string;
  skip?: number;
  length?: number;
  engine?: "auto" | "direct" | "browser";
  timeout?: number;
};

export async function fetchUrl(options: FetchUrlOptions): Promise<string> {
  const target = new URL(options.url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("fetch_url 只支持 http(s):// URL");
  }

  const endpoint = new URL(`/read/${options.url}`, options.baseUrl);
  const response = await fetch(endpoint, {
    headers: { "x-engine": options.engine || "auto" },
    signal: AbortSignal.timeout((options.timeout ?? 90) * 1000),
  });
  if (!response.ok) throw new Error(`jina reader 返回 HTTP ${response.status}`);

  return sliceText(await response.text(), options.skip, options.length);
}
