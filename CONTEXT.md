# 术语表 (Glossary)

本文件只记录术语与定义 —— 语义,不是实现细节。

- **工具层 (tool-layer)**:对外的 HTTP 后端。唯一入口是 nginx(`:28082`)。它把多个**能力**伪装成一个服务。
- **能力 (capability)**:工具层对外暴露的一个功能面:聚合搜索(searxng)、网页读取(jina)、文档检索(context7)、结构化数据(wikidata)。
- **引擎 (engine)**:searxng 的一个来源模块,把数据归一化成搜索结果三元组 `{url, title, content}`(如 google、bing、github、github code)。
- **搜索结果协议 (search-result protocol)**:三元组 `{url, title, content}`。`url` 指向一个稳定资源;`content` 是对该资源的摘要。逻辑假设:**同一网址 ↔ 同一内容**,可缓存、可复用、可分享。
- **文档能力 (docs capability)**:基于 context7 的"查库文档"能力。它天然是**两步**的。
- **发现 (discovery)**[step-1]:从一个查询里**认出是哪个库**,返回候选库(含 libraryId、标题、描述、评分)。
- **检索 (retrieval)**[step-2]:给定一个库(libraryId)+ 一个**概念查询**,取回该库的精准文档片段。
- **MCP 网关 (MCP gateway)**:nginx 反向代理一个外部 MCP 服务器,把它作为工具层的一部分身份暴露(如 `/wd/mcp` → Wikimedia wikidata MCP)。

## 关键区分

- 发现查询 与 检索查询 是**两种意图**:发现要的是"库名",检索要的是"库内概念"。同一个词往往不能同时当好两个查询。
- context7 的库描述是**元数据**(这个库是什么),不是**答案**(这个库怎么用)。一条搜索结果的 `content` 若只填描述,则只是"提示",不携带答案。
