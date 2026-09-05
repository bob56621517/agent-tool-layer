import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { config } from "./config.js";
import { fetchUrl, readFile, webSearch } from "./tools/index.js";

export function buildServer(): McpServer {
  const server = new McpServer({ name: "agent-tool-layer", version: "0.1.0" });

  server.registerTool(
    "web_search",
    {
      description: "SearXNG 聚合网页搜索，只返回网页列表，不做 AI 总结。",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        query: z.string().min(1).describe("搜索词"),
        count: z.number().int().min(1).max(50).optional().describe("返回条数，默认 20"),
        freshness: z.string().optional().describe("时效:noLimit/oneDay/oneWeek/oneMonth/oneYear"),
        include: z.string().optional().describe("限定域名,多个用 | 或 , 分隔"),
      },
    },
    async input => ({
      content: [{
        type: "text",
        text: await webSearch({
          baseUrl: config.toolLayerUrl,
          bochaApiKey: config.bochaApiKey,
          query: input.query,
          count: input.count,
          freshness: input.freshness,
          include: input.include,
          timeout: config.readTimeout,
        }),
      }],
    }),
  );

  server.registerTool(
    "fetch_url",
    {
      description: "抓取 http(s) 网页并转换为 Markdown。",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        url: z.string().url().describe("目标 http(s) URL"),
        skip: z.number().int().min(0).optional().describe("起始字符偏移"),
        length: z.number().int().min(1).max(50000).optional().describe("返回字符数"),
        engine: z.enum(["auto", "direct", "browser"]).optional().describe("reader 引擎"),
        timeout: z.number().int().min(1).max(600).optional().describe("超时秒数"),
      },
    },
    async input => ({
      content: [{
        type: "text",
        text: await fetchUrl({
          baseUrl: config.toolLayerUrl,
          url: input.url,
          skip: input.skip,
          length: input.length ?? config.readLength,
          engine: input.engine,
          timeout: input.timeout ?? config.readTimeout,
        }),
      }],
    }),
  );

  server.registerTool(
    "read_file",
    {
      description: "上传本机文档并转换为 Markdown。",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        path: z.string().min(1).describe("本机文件路径"),
        skip: z.number().int().min(0).optional().describe("起始字符偏移"),
        length: z.number().int().min(1).max(50000).optional().describe("返回字符数"),
        engine: z.enum(["auto", "direct", "browser"]).optional().describe("reader 引擎"),
        timeout: z.number().int().min(1).max(600).optional().describe("超时秒数"),
      },
    },
    async input => ({
      content: [{
        type: "text",
        text: await readFile({
          baseUrl: config.toolLayerUrl,
          path: input.path,
          skip: input.skip,
          length: input.length ?? config.readLength,
          engine: input.engine,
          timeout: input.timeout ?? config.readTimeout,
        }),
      }],
    }),
  );

  return server;
}
