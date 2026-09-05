# agent-tool-layer —— 联网搜索工具层后端

给 LLM / agent 提供"联网"能力的一套本地容器化后端。对外暴露的是 **HTTP API**(不只是 MCP),agent 可以直接用 HTTP 调它。

一个 nginx 入口(唯一对外端口 `28082`)把多个服务伪装成一个:聚合搜索 + 网页读取 + MCP 网关。核心 REST 能力在本地跑;MCP 网关按需代理外部公网服务。

## 功能一览

| 功能 | 路径 | 说明 |
|------|------|------|
| 聚合搜索 | `GET /search?format=json&q=...` | searxng 聚合 google/bing/baidu/duckduckgo,bocha 兜底 |
| 聚合搜索(HTML 页面) | `GET /search?q=...` | 直接用浏览器搜 |
| 网页转 Markdown | `GET /read/<url>` | 读取任意 URL,返回 Markdown 文本 |
| 服务配置 | `GET /config` | 当前启用的引擎等信息 |
| context7 | `/mcp/context7/` | **MCP** 代理(不是 REST),用于库文档 |
| wikidata | `/mcp/wikidata/` | **MCP** 代理(不是 REST),用于结构化数据 |
| grep_app | `/mcp/grep_app/` | **MCP** 代理(不是 REST),用于代码搜索 |

- searxng 的原始路由( `/search`、`/config` 等)原样保留在根路径;
- 网页读取挂在 `/read/` 前缀下(映射到 jina reader);
- GET / POST 都支持;
- 限流由 nginx 承担(按客户端 IP),searxng 关闭自身 limiter。

服务构成:**nginx(唯一入口,负责限流)+ searxng(聚合搜索)+ jina(Reader)**。无 valkey——限流在 nginx 层做,searxng 用不到 valkey。

## MCP 网关

`/mcp/<service>` 前缀统一代理三个外部 MCP 服务器:`context7`、`wikidata` 和 `grep_app`。这些接口遵循 MCP streamable-HTTP 语义(JSON-RPC + SSE),不是普通 REST API。MCP 客户端可以把这个网关作为单一 base URL 使用,再按服务名区分后端;认证由各 MCP 服务自持,当前三个服务均匿名访问。

无尾斜杠请求会通过 `308` 重定向到有尾斜杠形式,因此 `POST /mcp/context7` 与 `POST /mcp/context7/` 都可连。MCP 流量不套用 web 路由的 5 r/s 限流,由上游自行限流。

验证示例:

```bash
curl -L -sS http://localhost:28082/mcp/context7/ \
  -X POST \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}}}'
```

## 部署

前置:本机已装 Docker(含 compose 插件),且能拉取 `ghcr.io` 镜像。

### 1. 准备环境变量

```bash
cd docker
cp .env.example .env
# 编辑 .env,至少填 SEARXNG_SECRET
```

必要项:

- `SEARXNG_SECRET` —— searxng 服务端密钥,**必填**,可用 `openssl rand -hex 32` 生成。

可选项(不填则对应能力降级):

- `BOCHA_API_KEY` —— bocha(博查)付费兜底搜索。不填则聚合只靠常用源,网络差时可能无结果。bocha 单次拉满返回 50 条(博查按次计费,拉满不贵)。
- `GITHUB_TOKEN` —— 见下方"GitHub 搜索"说明,默认不填(走匿名限流)。

### 2. 启动

```bash
docker compose up -d
```

启动后检查:

```bash
docker compose ps
# nginx 应显示 0.0.0.0:28082->8080/tcp,其余服务无对外端口
```

> 首次启动 searxng 需初始化(几十秒),jina 因为要拉起 Chrome/puppeteer 启动更慢(需 ~4G 内存、启动窗口较长),稍等片刻等它们健康。

### 3. 验证

```bash
# 搜索
curl "http://localhost:28082/search?format=json&q=hello"

# 读网页 → Markdown
curl "http://localhost:28082/read/https://example.com"

# 服务配置(可用引擎)
curl "http://localhost:28082/config"
```

## 用法

### 聚合搜索

```bash
# JSON 结果(给 agent 用)
curl "http://localhost:28082/search?format=json&q=deepseek"

# 只调某个引擎(用引擎名,单名单词引擎可直接过滤;带空格的引擎名需 URL 编码)
curl "http://localhost:28082/search?format=json&q=test&engines=bocha"
curl "http://localhost:28082/search?format=json&q=searxng&engines=github"
```

`format=json` 返回结构:顶层 `results` 数组,每项含 `url` / `title` / `content` / `engine` 等字段;`unresponsive_engines` 列出失败的引擎。

> 单名单词引擎(如 `bocha`、`github`)能直接用 `engines=` 过滤。带空格的引擎名如 `github code`(`github_code`)与 searxng 的 `engines=` 参数兼容性不佳,建议用 `POST /search` 传 `engines` 数组或依赖默认聚合,而不是在 URL 里拼。

### 网页 → Markdown

```bash
curl "http://localhost:28082/read/https://httpbin.org/html"
```

> `/read/` 后面的部分原样作为目标 URL。URL 里的 `/`、`?`、`#` 都能被正确处理,无需额外转义。

### POST 方式

searxng 的 `/search` 支持 POST,搜索词更适合放 body(不进 URL 历史):

```bash
curl -X POST "http://localhost:28082/search" -d "q=test&format=json"
```

### 用类别过滤

searxng 支持按类别聚合(如 `general` / `it` / `code` / `images`):

```bash
curl "http://localhost:28082/search?format=json&q=python&categories=general"
```

## 搜索引擎说明

- **常用源**:google / bing / baidu / duckduckgo / 360search。部分网络环境下(数据中心 IP)google / duckduckgo / baidu 可能被反爬(超时或 CAPTCHA),searxng 会自动隔离这些失败引擎,不阻塞整体结果。bing / 360 相对稳。
- **bocha(兜底)**:付费源(博查),权重较高,保证任何网络条件下有结果。只用 `web-search` 端点,不带 AI 总结。单次拉满 50 条。
- **github**:仓库搜索(`github`)。**github_code(代码搜索)**:走 `GITHUB_TOKEN` 环境变量(启动时由 `entrypoint.sh` 自动注入 settings,不落盘)。设了 `GITHUB_TOKEN` 用认证模式(配额高);不设则自动回退匿名(限流严)。

## 目录结构

```
docker/
├── docker-compose.yml          # 3 服务编排(nginx / searxng / jina)
├── nginx/nginx.conf            # 反代入口(searxng 原样 + jina /read/) + 限流
├── searxng/
│   ├── settings.yml            # 引擎清单 + 默认值
│   ├── entrypoint.sh           # 把 GITHUB_TOKEN 注入 settings(到 /tmp)
│   └── engines/bocha.py        # bocha 自定义引擎
├── .env.example                # 环境变量模板
└── .gitignore
```

REST 能力(`/search`、`/read`、`/config`)保持不变。

## 常见问题

**`/search?format=json` 返回 403** —— settings.yml 里的 `search.formats` 必须包含 `json`(本仓库已配置)。

**返回 429 Too Many Requests** —— 这是 nginx 的限流(`limit_req`)按客户端 IP 拦的。默认 10 请求/秒、突发 20;可在 `docker/nginx/nginx.conf` 里调 `limit_req_zone` 的 `rate` 与 `limit_req` 的 `burst`。若你的 agent 高并发,适当放宽。

**searxng 重建后 nginx 502** —— nginx 已配置 Docker DNS 自动重新解析(`resolver` + `resolve`),通常无需手动重启;若仍 502,`docker restart atl-nginx`。

**jina 起不来 / 内存不足** —— jina 需要较多内存,compose 里已设 4G 上限、1G 预留;若宿主内存紧张可调小 `deploy.resources.limits.memory`。

**`SEARXNG_SECRET is required`** —— 启动前需有 `.env`(模板见 `.env.example`),或系统环境变量里已设置该值。
