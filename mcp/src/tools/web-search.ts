import { sliceText } from "../slice.js";

const FRESHNESS_TO_TIME_RANGE: Record<string, string> = {
  oneDay: "day",
  oneWeek: "week",
  oneMonth: "month",
  oneYear: "year",
};

const FRESHNESS_DATE_RANGE = /^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?$/;

export type WebSearchOptions = {
  baseUrl: string;
  bochaApiKey?: string;
  query: string;
  count?: number;
  freshness?: string;
  include?: string;
  timeout?: number;
};

type SearxngResult = {
  url?: string;
  title?: string;
  content?: string;
};

export async function webSearch(options: WebSearchOptions): Promise<string> {
  const endpoint = new URL("/search", options.baseUrl);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("q", options.query);
  endpoint.searchParams.set("count", String(Math.min(50, Math.max(1, options.count ?? 20))));

  const timeRange = options.freshness ? FRESHNESS_TO_TIME_RANGE[options.freshness] : undefined;
  if (timeRange) endpoint.searchParams.set("time_range", timeRange);
  const freshness = options.freshness || "";
  if (freshness !== "noLimit" && FRESHNESS_DATE_RANGE.test(freshness)) {
    endpoint.searchParams.set("engine_data[bocha][freshness]", freshness);
  }

  const domains = (options.include || "")
    .split(/[|,]/)
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length > 0) endpoint.searchParams.set("count", "50");

  const headers: Record<string, string> = {};
  if (options.bochaApiKey) headers["X-Bocha-Api-Key"] = options.bochaApiKey;

  const response = await fetch(endpoint, {
    headers,
    signal: AbortSignal.timeout((options.timeout ?? 90) * 1000),
  });
  if (!response.ok) throw new Error(`searxng 返回 HTTP ${response.status}`);

  const payload = await response.json() as { results?: SearxngResult[] };
  const results = payload.results?.filter(result => result.url) ?? [];
  const matchingResults = domains.length === 0
    ? results
    : results.filter(result => {
      try {
        const hostname = new URL(result.url!).hostname.toLowerCase();
        return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
      } catch {
        return false;
      }
    });
  const selectedResults = matchingResults.slice(0, Math.min(50, Math.max(1, options.count ?? 20)));
  if (selectedResults.length === 0) return "没有找到网页结果。";

  return selectedResults
    .map((result, index) => {
      const title = result.title || result.url || "";
      const content = result.content ? `\n${sliceText(result.content, 0, 5000)}` : "";
      return `${index + 1}. [${title}](${result.url})${content}`;
    })
    .join("\n\n");
}
