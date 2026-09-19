#!/usr/bin/env bash
# jev-cli 一键安装：CLI + 引导配置 API key
#
# 说明：pi 扩展（jev / jev_triage）已改为通过 pi 包分发，不再由本脚本
# 安装到全局 extensions 目录（避免与 pi 包重复注册导致工具名冲突）：
#   pi install git:github.com/gmaxxxie/jev-cli
#
# 两种运行方式：
#   1. 网络安装（推荐）：
#      curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/install.sh | bash
#   2. 本地仓库运行：
#      bash install.sh   （在 jev-cli 仓库目录里）
set -euo pipefail

INSTALL_CLI="${INSTALL_CLI:-1}"
REPO_BASE="https://raw.githubusercontent.com/gmaxxxie/jev-cli/main"

# 本地优先，找不到就走网络（curl 安装时没有本地仓库目录）
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/bin/jev" ]]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fetch() { cp "$SRC/$1" "$2"; }
else
  fetch() {
    local tmp; tmp="$(mktemp)"
    curl -fsSL "$REPO_BASE/$1" -o "$tmp"
    mv "$tmp" "$2"
  }
fi

echo "==> jev-cli installer"

if [[ "$INSTALL_CLI" == "1" ]]; then
  mkdir -p "$HOME/.local/bin"
  # 本地仓库运行 → 装软链，单一事实源（改仓库即生效，重跑 install.sh 不覆盖本地修改）。
  # 网络安装（curl | bash）没有仓库可链，退回拷贝。
  if [[ -n "${SRC:-}" ]]; then
    ln -sf "$SRC/bin/jev" "$HOME/.local/bin/jev"
    echo "    CLI 已软链到 $HOME/.local/bin/jev → $SRC/bin/jev"
  else
    fetch "bin/jev" "$HOME/.local/bin/jev"
    chmod +x "$HOME/.local/bin/jev"
    echo "    CLI 已安装到 $HOME/.local/bin/jev（网络安装，独立副本）"
  fi
  if command -v python3 >/dev/null 2>&1; then
    echo "    python3: $(python3 --version)"
  else
    echo "    ⚠ 未检测到 python3，请先安装 Python 3"
  fi
fi

# 若存在旧版全局扩展（历史 install.sh 安装的），提示改用 pi 包，避免冲突
if [[ -f "$HOME/.pi/agent/extensions/jev.ts" || -f "$HOME/.pi/agent/extensions/jev-triage.ts" ]]; then
  echo "    ⚠ 检测到旧版全局扩展，请移除并用 pi 包方式安装："
  echo "      rm $HOME/.pi/agent/extensions/jev.ts $HOME/.pi/agent/extensions/jev-triage.ts"
  echo "      pi install git:github.com/gmaxxxie/jev-cli"
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
