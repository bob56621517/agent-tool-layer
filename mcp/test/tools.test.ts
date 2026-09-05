import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchUrl, readFile, webSearch } from "../src/tools/index.js";

let server: Server;
let baseUrl = "";
let uploadedName = "";
let uploadedType = "";
let engineFreshness = "";

beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname === "/search") {
      expect(request.headers["x-bocha-api-key"]).toBe("test-key");
      engineFreshness = new URL(request.url ?? "/", "http://localhost").searchParams.get("engine_data[bocha][freshness]") ?? "";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        results: [
          { url: "https://example.com/1", title: "First", content: "First content" },
          { url: "https://other.com/2", title: "Other", content: "Other content" },
          { url: "https://docs.example.com/3", title: "Second", content: "Second content" },
        ],
      }));
      return;
    }

    if (request.url === "/read/https://example.com/page") {
      response.end("# Hello\n\nFull document body.");
      return;
    }

    if (request.method === "POST" && new URL(request.url ?? "/", "http://localhost").pathname === "/read/") {
      const contentType = request.headers["content-type"] ?? "";
      uploadedType = contentType;
      let body = "";
      for await (const chunk of request) body += String(chunk);
      uploadedName = /filename="([^"]+)"/.exec(body)?.[1] ?? "";
      response.end("# Uploaded\n\nDocument content.");
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
});

describe("MCP tools", () => {
  test("web_search sends the Bocha key header and returns web results", async () => {
    const result = await webSearch({
      baseUrl,
      bochaApiKey: "test-key",
      query: "searxng",
      count: 2,
      freshness: "oneWeek",
      include: "example.com",
    });
    expect(result).toContain("https://example.com");
    expect(result).toContain("Second content");
    expect(result).not.toContain("Other content");
  });

  test("fetch_url reads a URL and applies skip/length", async () => {
    const first = await fetchUrl({ baseUrl, url: "https://example.com/page", length: 5 });
    const second = await fetchUrl({ baseUrl, url: "https://example.com/page", skip: 5, length: 5 });
    expect(first).toBe("# Hel");
    expect(second).toBe("lo\n\nF");
  });

  test("read_file uploads a local document with the required headers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tool-layer-mcp-"));
    try {
      const path = join(directory, "sample.md");
      await writeFile(path, "# Sample");
      const result = await readFile({ baseUrl, path, skip: 2, length: 8 });
      expect(uploadedName).toBe("sample.md");
      expect(uploadedType).toContain("multipart/form-data");
      expect(result).toBe("Uploaded");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("web_search passes date-range freshness through Bocha engine data", async () => {
  await webSearch({
    baseUrl,
    bochaApiKey: "test-key",
    query: "Model Context Protocol",
    freshness: "2026-01-01..2026-01-31",
  });
  expect(engineFreshness).toBe("2026-01-01..2026-01-31");
});
