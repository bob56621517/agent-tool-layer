# SPDX-License-Identifier: AGPL-3.0-or-later
"""Bocha (博查) 自定义在线搜索引擎.

接入博查 Web Search API 作为 SearXNG 的兜底引擎。
参数契约参考用户已有的两个客户端实现:

- py: ``bocha-search-mcp`` 的 ``bocha_web_search``
- ts: ``search-reader-mcp`` 的 ``server/src/bocha/client.ts`` (更完整,以此为准)

仅使用 ``web-search`` 端点,不使用 ``ai-search``(AI 总结 / 模态卡无法由
通用引擎通道承载)。

配置
====

在 ``settings.yml`` 引擎清单中添加一个条目,并通过环境变量 ``BOCHA_API_KEY``
注入密钥(见 ``docker-compose.yml``)::

  - name: bocha
    engine: bocha
    shortcut: bocha
    categories: [general]
    weight: 1

**API 契约要点:**
- 端点: ``POST https://api.bochaai.com/v1/web-search``
- 认证: ``Authorization: Bearer <BOCHA_API_KEY>``
- 字段: ``query`` 必填;``count`` 钳制 1..50 默认 50(兜底拉满);``freshness`` 枚举或日期区间;
  ``summary`` 布尔
- 响应: 顶层 ``code === 200`` 才成功,否则取 ``msg``;结果在 ``data.webPages.value[]``
"""

import asyncio
import os
import re
from dateutil import parser as date_parser

from searx.exceptions import SearxEngineAccessDeniedException
from searx.network import get_context_network
from searx.network.client import get_loop

engine_type = "online"
categories = ["general"]
paging = False
timeout = 10.0
# 允许 searxng 把 time_range(如 oneMonth 等)透传给引擎,映射为 bocha 的 freshness
time_range_support = True

# about
about = {
    "website": "https://www.bochaai.com/",
    "wikidata_id": None,
    "official_api_documentation": "https://www.bochaai.com/",
    "use_official_api": True,
    "require_api_key": True,
    "results": "JSON",
}

# 请求端点
search_api = "https://api.bochaai.com/v1/web-search"

# bocha freshness 允许的枚举;日期区间(YYYY-MM-DD 或 YYYY-MM-DD..YYYY-MM-DD)单独校验
FRESHNESS_VALUES = {"noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"}
FRESHNESS_DATE_RANGE = r"^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?$"

# searxng time_range(day/week/month/year) -> bocha freshness 的映射
TIME_RANGE_TO_FRESHNESS = {
    "day": "oneDay",
    "week": "oneWeek",
    "month": "oneMonth",
    "year": "oneYear",
}

# 引擎配置(由 init() 注入,含 settings.yml 中该条目的自定义键)
# 若无显式配置,回退到环境变量
_bocha_api_key = ""
_bocha_count = 50


def init(engine_settings):
    """初始化:读取 settings.yml 中 bocha 条目的 ``api_key`` 与 ``count``.

    未配置 ``BOCHA_API_KEY`` 时返回 ``False``,让 searxng 跳过本引擎(不启用),
    而非报错——考虑欠费/未配置场景,bocha 作为兜底源不应阻塞其它引擎。
    """
    global _bocha_api_key, _bocha_count

    api_key = engine_settings.get("api_key")
    if not api_key:
        api_key = os.environ.get("BOCHA_API_KEY", "")
    _bocha_api_key = api_key

    # 兜底场景尽量拉满结果数;bocha 上限 50,可经 settings.yml 的 count 调整
    count = engine_settings.get("count", 50)
    try:
        _bocha_count = max(1, min(int(count), 50))
    except (TypeError, ValueError):
        _bocha_count = 50

    # 无 key 时不启用引擎(searxng 会跳过它,不阻塞聚合)
    return bool(_bocha_api_key)


def request(query, params):
    """构建 POST 请求:填入 URL、headers、json body."""
    if not _bocha_api_key:
        # 不应发生(init 无 key 时引擎不会被调用),这里防御性返回空结果
        return params

    body = {"query": query}
    body["summary"] = True
    body["count"] = _bocha_count

    # 若 searxng 提供了 time_range,映射为 bocha freshness。
    # searxng 的取值是 day/week/month/year,bocha 要求 oneDay/oneWeek/oneMonth/oneYear,
    # 需先映射;再按枚举/日期区间校验,未知值回退 noLimit(对齐 ts 客户端 normalizeFreshness)。
    time_range = params.get("time_range")
    if time_range:
        freshness = TIME_RANGE_TO_FRESHNESS.get(str(time_range), time_range)
        if freshness in FRESHNESS_VALUES or re.match(FRESHNESS_DATE_RANGE, str(freshness)):
            body["freshness"] = freshness
        else:
            body["freshness"] = "noLimit"

    params["url"] = search_api
    params["method"] = "POST"
    params["headers"]["Authorization"] = f"Bearer {_bocha_api_key}"
    params["headers"]["Content-Type"] = "application/json"
    params["json"] = body

    return params


def _reset_connection():
    """同步触发一次网络连接重置(关闭当前引擎的连接池).

    欠费/计费类错误时,searxng 的 httpx 连接池里会留一条\"看似有效\"的连接,
    充值后复用会导致需重启才恢复。此函数在同步的 response() 里强制丢弃连接池,
    下次请求用全新连接。``aclose`` 是 async,这里用事件循环同步调度。
    """
    try:
        network = get_context_network()
        loop = get_loop()
        asyncio.run_coroutine_threadsafe(network.aclose(), loop)
    except Exception:  # pylint: disable=broad-except
        # 连接重置失败不应影响引擎主体,静默即可
        pass


def response(resp):
    """解析 bocha 响应,返回 searxng 结果列表(dict)。"""
    json_data = resp.json()

    # 顶层 code !== 200 视为失败;认证/计费类失败(欠费)会留下\"假有效\"连接,
    # 主动重置连接池而非复用,充值后无需重启。
    code = json_data.get("code", -1)
    if code != 200:
        msg = json_data.get("msg") or json_data.get("message") or "unknown bocha error"
        _reset_connection()
        raise SearxEngineAccessDeniedException(message=f"bocha error (code={code}): {msg}")

    pages = (json_data.get("data") or {}).get("webPages") or {}
    results = []

    for item in pages.get("value") or []:
        url = item.get("url")
        if not url:
            continue

        result = {
            "url": url,
            "title": item.get("name") or "",
            "content": item.get("summary") or item.get("snippet") or "",
            "engine": "bocha",
        }

        # 出版日期:searxng 的 result 规范化会对 publishedDate 调用 .strftime,
        # 因此必须解析成 datetime 对象(参照内置引擎 github.py 的做法)。
        date_published = item.get("datePublished")
        if date_published:
            try:
                result["publishedDate"] = date_parser.parse(str(date_published))
            except (ValueError, TypeError):
                pass

        results.append(result)

    return results
