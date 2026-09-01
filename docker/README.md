# agent-tool-layer —— 联网搜索工具层后端

给 LLM / agent 提供"联网"能力的一套本地容器化后端。对外暴露的是 **HTTP API**(不只是 MCP),agent 可以直接用 HTTP 调它。

一个 nginx 入口(唯一对外端口 `28082`)把两个服务伪装成一个:聚合搜索 + 网页读取。整个后端在本地跑,不依赖公有云。

## 功能一览

| 功能 | 路径 | 说明 |
|------|------|------|
| 聚合搜索 | `GET /search?format=json&q=...` | searxng 聚合 google/bing/baidu/duckduckgo,bocha 兜底 |
| 聚合搜索(HTML 页面) | `GET /search?q=...` | 直接用浏览器搜 |
| 网页转 Markdown | `GET /read/<url>` | 读取任意 URL,返回 Markdown 文本 |
| 服务配置 | `GET /config` | 当前启用的引擎等信息 |

- searxng 的原始路由( `/search`、`/config` 等)原样保留在根路径;
- 网页读取挂在 `/read/` 前缀下(映射到 jina reader);
- GET / POST 都支持。

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

- `BOCHA_API_KEY` —— bocha(博查)付费兜底搜索。不填则聚合只靠常用源,网络差时可能无结果。
- `GITHUB_TOKEN` —— 见下方"GitHub 搜索"说明,默认不填。

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

- **常用源**:google / bing / baidu / duckduckgo。部分网络环境下 google / duckduckgo 可能不稳定(超时或 CAPTCHA),searxng 会自动隔离这些失败引擎,不阻塞整体结果。
- **bocha(兜底)**:付费源,权重较高,保证任何网络条件下有结果。只用 `web-search` 端点,不带 AI 总结。
- **github**:仓库搜索(`github`)。**github_code(代码搜索)**:默认走匿名(限流较严),如需提升配额,在 `docker/searxng/settings.yml` 的 `github code` 条目里把 `ghc_auth.type` 改为 `personal_access_token` 并填入 token(勿把真实 token 提交进仓库)。

## 目录结构

```
docker/
├── docker-compose.yml          # 4 服务编排
├── nginx/nginx.conf            # 反代入口(searxng 原样 + jina /read/)
├── searxng/
│   ├── settings.yml            # 引擎清单 + 默认值
│   ├── limiter.toml            # 限流配置
│   └── engines/bocha.py        # bocha 自定义引擎
├── .env.example                # 环境变量模板
└── .gitignore
```

## 常见问题

**`/search?format=json` 返回 403** —— settings.yml 里的 `search.formats` 必须包含 `json`(本仓库已配置)。

**searxng 重建后 nginx 502** —— nginx 已配置 Docker DNS 自动重新解析(`resolver` + `resolve`),通常无需手动重启;若仍 502,`docker restart atl-nginx`。

**jina 起不来 / 内存不足** —— jina 需要较多内存,compose 里已设 4G 上限、1G 预留;若宿主内存紧张可调小 `deploy.resources.limits.memory`。

**`SEARXNG_SECRET is required`** —— 启动前需有 `.env`(模板见 `.env.example`),或系统环境变量里已设置该值。
