# agent-tool-layer · MCP 层(stdio)

`mcp/` 是基于 **Node + TypeScript + bun** 的**本地 stdio MCP 服务**,复用本仓库 `:28082`(自部署 nginx)的后台能力(searxng 聚合搜索 + jina reader)。agent 通过 stdio 拉起该进程即用;进程**非常驻**,但启动时自检并保证后台 docker 服务常驻。

## 功能列表

| 工具 | 说明 |
|------|------|
| `web_search` | SearXNG 聚合网页搜索,**只返回网页列表,不做 AI 总结** |
| `fetch_url` | 抓取 `http(s)://` URL,jina 转 Markdown,支持分片续读 |
| `read_file` | 上传本机文档(Word/Excel/PPT/PDF/HTML 等)转 Markdown,支持分片续读 |

这三个工具均标注 `readOnlyHint: true`(只读),统一走 `:28082` 入口。

## 前置与构建

**前置**:
- 已安装 **bun**(构建/运行);若端口不通需要拉起后台,本机须已装 **Docker + Compose 插件**;或已有可用的 `TOOL_LAYER_URL` 后台服务(则无需 Docker)。

**构建**:

```bash
cd mcp
bun install          # 依赖:@modelcontextprotocol/sdk + zod
bun run build
```

产物:`mcp/dist/mcp/index.js`,并附带 `mcp/dist/docker/`(由 `scripts/copy-docker.ts` 从仓库根 `docker/` 拷贝,含 `docker-compose.yml` 与 nginx/searxng 配置,已排除本机 `.env`,不含密钥)。

## 运行 / 配置 agent(stdio)

产物为可执行 JS,`bun` 或 `node` 均可拉起。以 Claude Code 等 MCP 客户端为例:

```json
{
  "mcpServers": {
    "agent-tool-layer": {
      "command": "bun",
      "args": ["run", "<本仓库绝对路径>/mcp/dist/mcp/index.js"],
      "env": {
        "TOOL_LAYER_URL": "http://localhost:28082",
        "BOCHA_API_KEY": "<可选,searxng bocha 兜底 key>",
        "SEARXNG_SECRET": "<可选;拉起 compose 必需,不传则读 docker/.env>"
      }
    }
  }
}
```

开发调试可用 `bun start`(即 `bun run src/index.ts`)。

## 工具参数

### `web_search`
| 参数 | 类型 | 说明 |
|------|------|------|
| `query` | string **必填** | 搜索词 |
| `count` | number 可选 | 返回条数,默认 20,上限 50 |
| `freshness` | string 可选 | 时效:`noLimit`/`oneDay`/`oneWeek`/`oneMonth`/`oneYear`,或单个日期 `YYYY-MM-DD` / 区间 `YYYY-MM-DD..YYYY-MM-DD`;无效值会被忽略 |
| `include` | string 可选 | 限定域名,多个用 `\|` 或 `,` 分隔 |

### `fetch_url`
| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string **必填** | 目标 `http(s)://` URL |
| `skip` | number 可选 | 起始字符偏移,默认 0 |
| `length` | number 可选 | 返回字符数,默认 5000,上限 50000 |
| `engine` | `'auto'/'direct'/'browser'` 可选 | reader 抓取引擎,默认 auto |
| `timeout` | number 可选 | 超时(秒),≤600 |

### `read_file`
| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string **必填** | 本机文件路径(stdio 与 agent 同机,直接可读) |
| `skip` | number 可选 | 起始字符偏移,默认 0 |
| `length` | number 可选 | 返回字符数,默认 5000,上限 50000 |
| `engine` | `'auto'/'direct'/'browser'` 可选 | 解析引擎,默认 auto |
| `timeout` | number 可选 | 超时(秒),≤600 |

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `TOOL_LAYER_URL` | `http://localhost:28082` | 自部署 nginx 入口;三工具目标与自检端点 |
| `READ_TIMEOUT` | `90` | read 类工具超时兜底(秒);正整数,≤600,非法回退默认 |
| `READ_LENGTH` | `5000` | 默认切片长度;正整数,≤50000,非法回退默认 |
| `BOCHA_API_KEY` | (空) | bocha 兜底 key;有值时 `web_search` 会经 `X-Bocha-Api-Key` header 传给 searxng |
| `SEARXNG_SECRET` | (空) | 拉起 compose 必需;缺失明确报错。**注意**:自动从 `.env.example` 复制得到的是**占位值**,需手动替换为真实随机 secret 才能正常启动 |
| `GITHUB_TOKEN` | (空) | 拉起 compose 时透传(searxng `github_code` 认证) |

## 启动自检(ensure-backend)

进程每次被拉起时,先检查 `${TOOL_LAYER_URL}/config` 是否返回 2xx:

- **情况 1(端口通)**:后台服务已存在,直接使用现有 searxng + jina;
- **情况 2(端口不通)**:定位内置 `docker/docker-compose.yml`(优先仓库根 `docker/`,打包形态回退 `dist/docker/`)→ 校验 `docker/.env`(缺则从 `.env.example` 复制;`SEARXNG_SECRET` 必填,否则报错)→ `docker compose up -d`(**幂等**,已在则不重建;容器 `restart: unless-stopped` 保障后台常驻)→ 轮询 `${TOOL_LAYER_URL}/config` 直至返回 2xx(最长等 5 分钟,超时报「后台服务启动超时」)。

> MCP 进程本身短命(stdio),但 docker 后台服务持续常驻;agent 下次拉起时端口已通,直接走情况 1。

## bocha 引擎 key 传递

SearXNG 的 `bocha` 引擎**不要求启动时配置 key**;调用方可在 `/search` 请求头带 `X-Bocha-Api-Key`(或 `Authorization: Bearer ...`)动态提供 key。`web_search` 在设置了 `BOCHA_API_KEY` 时会自动附带该 header。无 key 时引擎仍启用,调用会在 bocha API 侧返回认证错误,但 SearXNG 会隔离该引擎,不影响其它聚合源。
