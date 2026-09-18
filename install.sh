#!/usr/bin/env bash
# jev-cli 一键安装：CLI + pi 扩展 + 引导配置 API key
set -euo pipefail

INSTALL_CLI="${INSTALL_CLI:-1}"
INSTALL_EXT="${INSTALL_EXT:-1}"

# 仓库根目录（脚本所在位置的上一级）
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> jev-cli installer"

if [[ "$INSTALL_CLI" == "1" ]]; then
  mkdir -p "$HOME/.local/bin"
  cp "$REPO_DIR/bin/jev" "$HOME/.local/bin/jev"
  chmod +x "$HOME/.local/bin/jev"
  if command -v python3 >/dev/null 2>&1; then
    echo "    CLI 已安装到 $HOME/.local/bin/jev (python3: $(python3 --version))"
  else
    echo "    CLI 已安装，但未检测到 python3，请先安装 Python 3"
  fi
fi

if [[ "$INSTALL_EXT" == "1" ]]; then
  mkdir -p "$HOME/.pi/agent/extensions"
  cp "$REPO_DIR/extension/jev.ts" "$HOME/.pi/agent/extensions/jev.ts"
  echo "    pi 扩展已安装到 $HOME/.pi/agent/extensions/jev.ts（pi 里 /reload 生效）"
fi

# API key 引导
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  echo "    OPENROUTER_API_KEY 环境变量已设置，跳过配置"
elif [[ -z "${JEV_SKIP_KEY:-}" ]]; then
  read -r -p "    输入 OpenRouter API key（回车跳过）: " key
  if [[ -n "$key" ]]; then
    AUTH="$HOME/.pi/agent/auth.json"
    python3 - "$AUTH" "$key" <<'EOF'
import json, os, sys
p, key = sys.argv[1], sys.argv[2]
d = json.load(open(p)) if os.path.exists(p) else {}
d.setdefault("openrouter", {})["key"] = key
json.dump(d, open(p, "w"), indent=2)
print(f"    key 已写入 {p}")
EOF
  fi
fi

echo "==> 完成。试运行: jev 'hello world' -q ok:一切正常吗?"
