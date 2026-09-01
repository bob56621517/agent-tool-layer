#!/bin/sh
# searxng 自定义 entrypoint:把环境变量 GITHUB_TOKEN 注入 settings.yml 后再启动。
#
# 背景:searxng 的 settings.yml 不支持 ${VAR} 展开,而内置 github_code 引擎只认
# settings 里的 ghc_auth.token。此脚本在启动前把占位符替换为环境变量真实值:
#   - 有 GITHUB_TOKEN -> 注入为 personal_access_token
#   - 无 GITHUB_TOKEN -> 回退为匿名限流(type: "none"),不报错
# 注入后的 settings 写到容器内临时文件(/tmp),不落宿主机仓库,避免 token 入库。

set -u

# 模板 settings(compose 挂载到 /etc/searxng/settings.yml)
TEMPLATE="/etc/searxng/settings.yml"
# 注入后的实际生效 settings(容器内临时文件)
OUTPUT="/tmp/searxng-settings.yml"

# 无 GITHUB_TOKEN 时回退匿名
if [ -z "${GITHUB_TOKEN:-}" ]; then
    python3 - "$TEMPLATE" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# 把 token: "$GITHUB_TOKEN" 占位替换为空,并把 type 回退为 "none"(匿名限流)
text = text.replace('token: "$GITHUB_TOKEN"', 'token: ""')
text = text.replace(
    'type: "personal_access_token"',
    'type: "none"',
)

with open("/tmp/searxng-settings.yml", "w", encoding="utf-8") as f:
    f.write(text)
PYEOF
    echo "[entrypoint] GITHUB_TOKEN 未设置,github code 走匿名限流模式"
else
    # 有 GITHUB_TOKEN:把占位符替换为真实 token
    python3 - "$TEMPLATE" <<'PYEOF'
import os
import sys

path = sys.argv[1]
token = os.environ.get("GITHUB_TOKEN", "")
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace('"$GITHUB_TOKEN"', '"' + token + '"')

with open("/tmp/searxng-settings.yml", "w", encoding="utf-8") as f:
    f.write(text)
PYEOF
    echo "[entrypoint] GITHUB_TOKEN 已注入 github code 引擎"
fi

# 让 searxng 使用注入后的 settings 文件,再调官方 entrypoint
export SEARXNG_SETTINGS_PATH="$OUTPUT"
exec /usr/local/searxng/entrypoint.sh
