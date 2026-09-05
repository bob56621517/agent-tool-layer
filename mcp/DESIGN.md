# agent-tool-layer · MCP 层(stdio)设计规格

> 本文件是 MCP 层的**权威实现规格**(单一事实来源)。实现须严格遵循;除非经评审改动,否则以此为准。

## 1. 定位

在 `agent-tool-layer` 项目内新增一个 **stdio 本地 MCP 层**(子目录 `mcp/`),用 **Node + TypeScript + bun** 构建。它把项目已有的后台能力(searxng 聚合搜索 + jina reader)通过 **3 个 MCP 工具**暴露给本地 agent(Claude Code / codex 等),agent 通过 stdio 拉起该进程即用,进程本身**非常驻**。

外部能力全部走项目自部署的 nginx(`:28082`,唯一入口)。

```
agent-tool-layer/
├── docker/            # 既有后台服务(nginx + searxng + jina),compose 三服务
├── mcp/               # ★ 新增 MCP 层(Node+TS+bun,stdio)
│   ├── package.json / tsconfig.json / bun.lockb
│   ├── src/
│   │   ├── index.ts          # stdio 入口:先 ensure-backend 再挂工具
│   │   ├── ensure-backend.ts # 端口自检 → 必要时 docker compose up -d
│   │   ├── config.ts         # env 配置 + 布局常量
│   │   └── tools/
│   │       ├── web-search.ts # web_search -> searxng
│   │       ├── fetch-url.ts  # fetch_url  -> jina GET /read/<url>
│   │       └── upload-file.ts# read_file  -> jina POST /read/ (multipart 上传)
│   ├── DESIGN.md            # 本文件
│   └── test/
└── CONTEXT.md           # 补「MCP 层」「tool-layer」术语
```

## 2. 三个工具

统一走 `:28082`(自部署 nginx)。所有工具均 `readOnly`。

### 2.1 `web_search`(searxng 聚合搜索 · 无 AI)
- 实现:`GET ${TOOL_LAYER_URL}/search?format=json&q=<query>&count=<n>`(searxng 聚合,含 bocha 兜底),解析 `results[]` 为 `url/title/content` 文本;只列网页,**不做 AI 总结/模态卡/追问**。
- 参数:
  - `query` string **必填** 搜索词
  - `count` number 可选 默认 20,上限 50
  - `freshness` string 可选 时效(noLimit/oneDay/oneWeek/oneMonth/oneYear 或 `YYYY-MM-DD..YYYY-MM-DD`)
  - `include` string 可选 限定域名,多个用 `|` 或 `,`
- key 传递:调用 searxng 时把进程 env `BOCHA_API_KEY` 放进 HTTP header `X-Bocha-Api-Key`(见 §4)。

### 2.2 `fetch_url`(jina URL → Markdown)
- 实现:`GET ${TOOL_LAYER_URL}/read/<url>`(jina 抓取),按 `skip/length` 分片。
- 参数:
  - `url` string **必填** 目标 `http(s)://`
  - `skip` number 可选 默认 0
  - `length` number 可选 默认 5000,上限 50000
  - `engine` `'auto'|'direct'|'browser'` 可选 默认 auto
  - `timeout` number 可选 秒,≤600

### 2.3 `read_file`(本地文件 → Markdown · 展开 + 分片)
- 实现:读本机 `path` 文件 → `POST ${TOOL_LAYER_URL}/read/`(multipart,字段 `file`,带 `x-engine`/`x-retain-links: all`/`x-retain-images: all` 头)→ Markdown,按 `skip/length` 分片。
- 参数:
  - `path` string **必填** 本地文件路径(agent 机器可访问,stdio 与 agent 同机)
  - `skip` number 可选 默认 0
  - `length` number 可选 默认 5000,上限 50000
  - `engine` `'auto'|'direct'|'browser'` 可选 默认 auto
  - `timeout` number 可选 秒,≤600
- 支持 web/.doc/.docx/.xls/.xlsx/.ppt/.pptx/PDF 等(参考 `mcp-hub/search-reader-mcp/test/fixtures` 覆盖)。

## 3. 启动自检 + 拉起后台(ensure-backend)

`index.ts` 每次被 agent 拉起时,先 `ensure-backend()` 再挂工具。

**判定标准:端口。** 检查 `${TOOL_LAYER_URL}`(`:28082`)是否可连——`GET /config` 返回 `2xx` 即视为「后台服务存在」。

- **情况 1(服务已存在,端口通)**:什么都不用做,直接用(现成的 searxng + jina);key 已由宿主 `.env` 或 searxng 配置提供,调用时按需带 header。
- **情况 2(服务不存在,端口不通)**:需要拉起,此时 key 由 MCP 进程 env 提供:
  1. 定位打包内置的 `docker/docker-compose.yml`(相对自己的 `__dirname`,见 §6);
  2. 检查 `docker/.env`:不存在则从 `docker/.env.example` 复制;若 `SEARXNG_SECRET` 为空则**明确报错**提示补齐(不静默);
  3. `docker compose -f <compose> up -d`(后台常驻;容器 `restart: unless-stopped` 保证常驻;**只启动一次**——compose 幂等,已在则不重建);
  4. 轮询等待 `${TOOL_LAYER_URL}` 就绪(带重试/超时)后继续。

> 「后台常驻、只启动一次」= compose `up -d` + 容器 `restart: unless-stopped`;MCP 进程本身短命,但后台 docker 服务持续常驻,agent 下次拉起时端口已通,直接走情况 1。

## 4. searxng 引擎 key 传递(bocha 引擎改造)

现状:bocha.py 在 `init()` 读 `settings/api_key` 或 `BOCHA_API_KEY` env,**无 key 即禁用引擎**(init 返回 False),`request()` 用全局 `_bocha_api_key` 拼 `Authorization`。

**改造目标**:searxng 启动时**不强制**要求 key;允许**外部传入的 HTTP header** 提供 key。
- `init()`:无 key 也**返回 True**(启用引擎,不再因缺 key 禁用);
- `request(query, params)`:优先从**客户端请求上下文**动态读取 key(searxng 引擎可通过 searx 请求上下文/客户端 header 取,如 `X-Bocha-Api-Key` 或 `Authorization`),兜底用启动时的 `_bocha_api_key`(env/settings)。
- 实现时用 searxng 的 venv(非容器默认 python3)验证「引擎能否读客户端 header」;若该版本机制取不到,回退方案:请求参数里也可传 key,或保持「启动 env 注入」为兜底,但**必须**满足「启动不写死、key 可由外部/调用侧传入」。

## 5. 配置(env)

| 变量 | 默认 | 说明 |
|---|---|---|
| `TOOL_LAYER_URL` | `http://localhost:28082` | 自部署 nginx 入口;ensure-backend 检测与三工具目标 |
| `READ_TIMEOUT` | `90` | read 类工具超时兜底(秒) |
| `READ_LENGTH` | `5000` | 默认切片长度,上限 50000 |
| `BOCHA_API_KEY` | (空) | 情况 2 拉起时透传/searxng header;也用于 web_search 调用 header |
| `SEARXNG_SECRET` | (空) | 情况 2 拉起 compose 必需(缺失则报错) |
| `GITHUB_TOKEN` | (空) | 情况 2 拉起时可透传(searxng github_code 认证) |

## 6. 打包(bun)

- 运行时:bun(兼容 Node)。开发用 `bun run`,构建用 `bun build`(**TS 直跑/打包**,无 webpack 等)。
- **打包产物必须包含 `docker/` 全目录**(`docker-compose.yml` + `nginx/` + `searxng/` + `.env.example`),供运行时 `ensure-backend` 用 `path.join(__dirname,'../docker/docker-compose.yml')` 定位(或从打包内 resource 读取)。
- 使 agent 可用 `bun`(或 `node`)拉起 `dist/index.js`(或 `bun` 单可执行)。选择不依赖复杂 npm 发布时,可产出「构建目录(含 `docker/`)」即可。

## 7. 测试要求

先跑通后台链路(与 mcp-hub 的 curl 验证一致),再验证 MCP 工具:
1. `curl :28082/config` 2xx(ensure-backend 情况 1 通路);
2. 三工具各自行为:web_search 返回网页列表(无 AI);fetch_url URL→markdown;read_file 用本地文件(mcp-hub fixtures)POST 上传→markdown,并验证 `skip/length` 分片;
3. stdio 会话:通过注入 JSON-RPC(MCP inspector 或脚本)验证 `tools/list` 含 3 工具、`tools/call` 各自有效;
4. ensure-backend 情况 2(模拟端口不通→拉起):验证能 `up -d` 启动 compose(或在测试环境验证命令构造正确);
5. bocha 引擎 header 传 key:验证无启动 key 也不禁用、且请求 header 带 key 时生效。

## 8. 术语(CONTEXT.md 需补)

- **MCP 层 (mcp layer)**:agent-tool-layer 内的 stdio 本地 MCP 服务子目录 `mcp/`,经 bun 打包,暴露 `web_search`/`fetch_url`/`read_file` 三工具,外部能力走 `:28082`。
- **tool-layer**:nginx 唯一入口(见根 CONTEXT.md)。
