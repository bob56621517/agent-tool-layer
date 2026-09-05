#!/bin/sh
# searxng 自定义 entrypoint:把环境变量(GITHUB_TOKEN)注入 settings.yml 后再启动官方 searxng。
#
# 背景:searxng 的 settings.yml 不支持 ${VAR} 展开,而内置引擎(github_code)
# 只认 settings 里的静态配置。此脚本在启动前把占位符替换为环境变量真实值。
#
# 各变量的处理策略(不设置时优雅降级,不报错):
#   - GITHUB_TOKEN -> github_code: 注入认证;无则回退匿名(type: none)
#   - BOCHA_API_KEY -> bocha 引擎由 bocha.py 的 init() 自行读 env(此处不处理)
#
# 注入后的 settings 写到容器内临时文件(/tmp),不落宿主机仓库,避免密钥入库。

set -u

# 模板 settings(compose 挂载到 /etc/searxng/settings.yml)
TEMPLATE="/etc/searxng/settings.yml"

python3 - "$TEMPLATE" <<'PYEOF'
import os
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

github_token = os.environ.get("GITHUB_TOKEN", "")

# ---- github_code 引擎 ----
if github_token:
    text = text.replace('"$GITHUB_TOKEN"', '"' + github_token + '"')
else:
    # 无 token:token 置空,type 回退为 "none"(匿名限流)
    text = text.replace('token: "$GITHUB_TOKEN"', 'token: ""')
    text = text.replace('type: "personal_access_token"', 'type: "none"')

with open("/tmp/searxng-settings.yml", "w", encoding="utf-8") as f:
    f.write(text)
PYEOF

# 输出注入情况的摘要(不打印密钥本体)
if [ -n "${GITHUB_TOKEN:-}" ]; then
    echo "[entrypoint] GITHUB_TOKEN 已注入 github code 引擎"
else
    echo "[entrypoint] GITHUB_TOKEN 未设置,github code 走匿名限流"
fi

# 让 searxng 使用注入后的 settings 文件,再调官方 entrypoint
export SEARXNG_SETTINGS_PATH="/tmp/searxng-settings.yml"
exec /usr/local/searxng/entrypoint.sh
