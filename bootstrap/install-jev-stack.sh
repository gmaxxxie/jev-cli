#!/usr/bin/env bash
# =============================================================================
# install-jev-stack.sh — 在一台设备上装好/升级整套 Jev 栈（幂等，可重复运行）
#
# 装什么（全部来自公网，无需从旧机器拷文件）：
#   1. pi 包 git:…/jev-cli          → jev 工具
#   2. 网页/信息工具                → pi-web-access / agent-browser / jev-ultrafast
#   3. ~/.local/bin/jev 软链        → 指向 jev-cli 仓库 bin/jev（单一事实源）
#   4. ~/.pi/agent/AGENTS.md 分工段 → 告诉 agent 什么场景用哪条通道
#   5. 网关默认值                   → jev-gateway.json = official
#   6. API key                      → ~/.pi/agent/pi-typesafe/auth.json（jev CLI 读取）
#
# 注：pi-typesafe 扩展（typesafe_evaluate）与 shell rc 环境变量块已于 2026-09 退役，
#     本脚本不再安装。但 auth.json 里的 key 仍由 jev CLI 使用，故 key 部分保留。
#
# 需要手动做的只有两件：API key，以及 jev-ultrafast 的 .env。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/bootstrap/install-jev-stack.sh | bash
#   # 或在仓库里：
#   bash bootstrap/install-jev-stack.sh
#
# 升级已装的旧版（拉最新包 + 装上前版没有的网页/信息工具）：
#   curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/bootstrap/install-jev-stack.sh | bash -s -- --update
#
# 选项：
#   --update      已装的包也拉最新（默认不动已装的包，只装缺的）
#   --no-key      跳过 key 交互（稍后自己 export TYPESAFE_API_KEY）
#   --no-agents   不写 ~/.pi/agent/AGENTS.md
#   --no-bashrc   已废弃（rc 环境变量块已退役），保留仅为兼容旧调用
#   --dry-run     只打印将要做什么，不改任何东西
#   -h, --help    帮助
# =============================================================================
set -euo pipefail

REPO_SLUG="gmaxxxie/jev-cli"
REPO_GIT="git:github.com/${REPO_SLUG}"
JEV_ULTRAFAST_GIT="https://github.com/browser-use/jev-ultrafast.git"
REPO_URL="https://github.com/${REPO_SLUG}"
EXPECTED_REPO_DIR="${HOME}/.pi/agent/git/github.com/${REPO_SLUG}"
TYPESAFE_AUTH="${HOME}/.pi/agent/pi-typesafe/auth.json"
OPENROUTER_AUTH="${HOME}/.pi/agent/auth.json"
GATEWAY_JSON="${HOME}/.pi/agent/jev-gateway.json"
AGENTS_MD="${HOME}/.pi/agent/AGENTS.md"
CLI_LINK="${HOME}/.local/bin/jev"

# rc 文件按登录 shell 选：写错文件 = 环境变量永远不生效（macOS 默认 zsh，不读 .bashrc）
# 用参数展开而非 basename，避免 PATH 里没有 coreutils 时挂掉
_shell_path="${SHELL:-/bin/bash}"
SHELL_NAME="${_shell_path##*/}"
unset _shell_path
case "$SHELL_NAME" in
  zsh)  RC_FILE="${HOME}/.zshrc" ; RC_KIND="zshrc" ;;
  bash) RC_FILE="${HOME}/.bashrc"; RC_KIND="bashrc" ;;
  *)    RC_FILE="${HOME}/.profile"; RC_KIND="profile（未知 shell ${SHELL_NAME}）" ;;
esac
BASHRC="$RC_FILE"   # 兼容旧变量名
# zsh 里 interactive guard 的写法与 bash 不同（默认无 guard，但常见 [[ -o interactive ]] / ZSH_EVAL_CONTEXT）

AGENTS_MARKER="## 判断 / 决策工具（Jev）"

DO_KEY=1 DO_AGENTS=1 DO_BASHRC=1 DRY_RUN=0 DO_UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --no-key) DO_KEY=0 ;;
    --no-agents) DO_AGENTS=0 ;;
    --no-bashrc) DO_BASHRC=0 ;;   # 已废弃（rc 块已退役），保留仅为兼容
    --dry-run) DRY_RUN=1 ;;
    --update) DO_UPDATE=1 ;;      # 已装的包也拉最新（升级旧设备用）
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: ${arg}（-h 看帮助）" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  B='' G='' Y='' R='' D='' N=''
fi
step() { printf '\n%s==>%s %s\n' "$B" "$N" "$1"; }
ok()   { printf '    %s✓%s %s\n' "$G" "$N" "$1"; }
skip() { printf '    %s·%s %s\n' "$D" "$N" "$1"; }
warn() { printf '    %s!%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '    %s✗%s %s\n' "$R" "$N" "$1" >&2; exit 1; }
run()  { if [[ $DRY_RUN == 1 ]]; then printf '    %s[dry-run]%s %s\n' "$D" "$N" "$*"; else "$@"; fi; }

printf '%s\n' "${B}整套 Jev 栈安装${N}  ${D}(jev-cli + CLI + 网页工具 + 分工文档)${N}"
[[ $DRY_RUN == 1 ]] && warn "dry-run 模式：只打印，不落盘"

# -----------------------------------------------------------------------------
step "1/7 预检依赖"
# -----------------------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || {
  warn "缺少 python3（jev CLI 是 Python 脚本）"
  case "$(uname -s 2>/dev/null)" in
    Darwin) warn "macOS: brew install python3   或   xcode-select --install" ;;
    Linux)  warn "装法: sudo apt install python3   或   sudo dnf install python3" ;;
    *)      warn "请先安装 Python 3" ;;
  esac
  die "装完 python3 后重跑本脚本"
}
# 版本号用纯 shell 解析：精简 PATH 里可能没有 awk/head
py_ver="$(python3 -V 2>&1)"
ok "python3 ${py_ver#Python }"
command -v pi >/dev/null 2>&1 || die "缺少 pi（先装 @earendil-works/pi-coding-agent）"
pi_ver="$(pi --version 2>/dev/null || true)"
ok "pi ${pi_ver%%$'\n'*}"
command -v git >/dev/null 2>&1 || die "缺少 git（pi install git:… 需要）"
git_ver="$(git --version 2>/dev/null || true)"
ok "git ${git_ver##* }"
ok "shell: $SHELL_NAME → rc 文件 $RC_FILE"

# -----------------------------------------------------------------------------
step "2/7 安装 pi 包"
# -----------------------------------------------------------------------------
installed_pkgs="$(pi list 2>/dev/null || true)"
has_pkg() { grep -qF "$1" <<<"$installed_pkgs"; }

# 已装则安装、已装且 --update 则拉最新。
# 默认不动已装的包（重跑脚本不该静默升级），但会提示怎么升。
install_or_update() {
  local pkg="$1" label="${2:-$1}"
  if ! has_pkg "$pkg"; then
    run pi install "$pkg"
    ok "$label 已安装"
  elif [[ $DO_UPDATE == 1 ]]; then
    if run pi update --extension "$pkg"; then
      ok "$label 已更新到最新"
    else
      warn "$label 更新失败（可能是网络或版本冲突），继续"
    fi
  else
    skip "$label 已安装（要升级加 --update）"
  fi
}

install_or_update "$REPO_GIT" "$REPO_GIT"

# -----------------------------------------------------------------------------
step "3/7 网页/信息工具"
# -----------------------------------------------------------------------------
# 这些工具来自三个独立安装源。jev_route 扩展已退役（清单现由 web-control-router
# skill 维护），但工具本身仍要装，否则网页/浏览器手段会缺失。

# fetch_content / web_search → pi-web-access
install_or_update "npm:pi-web-access" "npm:pi-web-access（fetch_content / web_search）"

# agent-browser → 全局 npm 包
if command -v agent-browser >/dev/null 2>&1; then
  if [[ $DO_UPDATE == 1 ]] && command -v npm >/dev/null 2>&1; then
    if run npm install -g agent-browser; then
      ok "agent-browser 已更新到最新"
    else
      warn "agent-browser 更新失败，继续"
    fi
  else
    skip "agent-browser 已在 PATH（要升级加 --update）"
  fi
elif command -v npm >/dev/null 2>&1; then
  run npm install -g agent-browser
  ok "agent-browser 已安装"
else
  warn "没有 npm，跳过 agent-browser（需自行安装）"
fi

# jev-ultrafast → 公开 Python 项目（需 uv + .env 密钥）
UF_DIR="${JEV_ULTRAFAST_DIR:-$HOME/Project/jev-ultrafast}"
if [[ -f "$UF_DIR/pyproject.toml" ]]; then
  if [[ $DO_UPDATE == 1 && -d "$UF_DIR/.git" ]]; then
    # 浅克隆（--depth 1）也能 pull，但需要跟踪分支信息
    if run git -C "$UF_DIR" pull --ff-only --quiet; then
      ok "jev-ultrafast 已更新"
    else
      warn "jev-ultrafast 更新失败（无跟踪分支或本地有改动），继续；可手动 cd $UF_DIR && git pull"
    fi
  else
    skip "jev-ultrafast 已存在于 $UF_DIR（要升级加 --update）"
  fi
elif command -v git >/dev/null 2>&1; then
  if [[ $DRY_RUN == 1 ]]; then
    printf '    %s[dry-run]%s 将 clone jev-ultrafast 到 %s\n' "$D" "$N" "$UF_DIR"
  else
    mkdir -p "$(dirname "$UF_DIR")"
    if run git clone --depth 1 "$JEV_ULTRAFAST_GIT" "$UF_DIR"; then
      ok "jev-ultrafast 已 clone 到 $UF_DIR"
    else
      warn "jev-ultrafast clone 失败（不影响其余功能）"
    fi
  fi
fi

if [[ -f "$UF_DIR/pyproject.toml" ]]; then
  if [[ -d "$UF_DIR/.venv" ]]; then
    skip "jev-ultrafast 依赖已同步（$UF_DIR/.venv）"
  elif ! command -v uv >/dev/null 2>&1; then
    warn "没有 uv，跳过 jev-ultrafast 依赖安装（需自行 uv sync）"
  elif [[ $DRY_RUN == 1 ]]; then
    printf '    %s[dry-run]%s 将在 %s 执行 uv sync\n' "$D" "$N" "$UF_DIR"
  elif run bash -c "cd '$UF_DIR' && uv sync"; then
    ok "jev-ultrafast 依赖已同步"
  else
    warn "uv sync 失败，请手动在 $UF_DIR 跑 uv sync"
  fi
  # .env 密钥只能人工填：密钥不该由脚本生成或代写
  if [[ ! -f "$UF_DIR/.env" ]]; then
    warn "jev-ultrafast 需要 $UF_DIR/.env（TYPESAFE_API_KEY / TEXT_MODEL_* 等），请自行填写"
  fi
fi

# -----------------------------------------------------------------------------
step "4/7 定位仓库并建 CLI 软链"
# -----------------------------------------------------------------------------
REPO_DIR=""
if [[ -f "$EXPECTED_REPO_DIR/bin/jev" ]]; then
  REPO_DIR="$EXPECTED_REPO_DIR"
else
  # pi 的克隆路径可能随版本变化，退而从 `pi list` 里解析
  REPO_DIR="$(pi list 2>/dev/null | awk -v slug="$REPO_SLUG" '
    index($0, slug) { getline; gsub(/^[ \t]+/, ""); print; exit }' || true)"
  [[ -n "$REPO_DIR" && -f "$REPO_DIR/bin/jev" ]] || REPO_DIR=""
fi
if [[ -z "$REPO_DIR" ]]; then
  warn "未找到 pi 克隆的仓库，改为单独 clone 到 ~/.local/share/jev-cli"
  REPO_DIR="${HOME}/.local/share/jev-cli"
  [[ -d "$REPO_DIR/.git" ]] || run git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi
[[ $DRY_RUN == 1 || -f "$REPO_DIR/bin/jev" ]] || die "仓库里没有 bin/jev：$REPO_DIR"
ok "仓库: $REPO_DIR"

for f in bin/jev extension/jev.ts; do
  [[ $DRY_RUN == 1 || -f "$REPO_DIR/$f" ]] || die "仓库缺少 ${f}（拉到的版本不对？）"
done
ok "CLI 脚本 + jev 扩展齐全"

# 复用仓库自带 install.sh 的软链逻辑（它本地运行时会 ln -sf 而不是 cp）
run env JEV_SKIP_KEY=1 INSTALL_CLI=1 bash "$REPO_DIR/install.sh"
if [[ -L "$CLI_LINK" ]]; then
  ok "软链: $CLI_LINK → $(readlink "$CLI_LINK")"
elif [[ -e "$CLI_LINK" ]]; then
  warn "$CLI_LINK 是普通文件（旧版拷贝安装），已由 install.sh 覆盖为软链"
else
  [[ $DRY_RUN == 1 ]] || die "软链未创建：$CLI_LINK"
fi
# Windows / WSL 提醒：原生 Windows 上 ~/.local/bin 不在 PATH，软链语义也不同
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    warn "检测到 Windows shell：~/.local/bin/jev 可能不在 PATH。"
    warn "推荐在 WSL 里跑本脚本；原生 Windows 需手动把 %USERPROFILE%\\.local\\bin 加进 PATH。"
    ;;
esac
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ok "~/.local/bin 已在 PATH 中" ;;
  *) warn "~/.local/bin 不在 PATH：请把 'export PATH=\"\$HOME/.local/bin:\$PATH\"' 加进 $RC_FILE" ;;
esac

# -----------------------------------------------------------------------------
step "5/7 网关默认值"
# -----------------------------------------------------------------------------
if [[ -f "$GATEWAY_JSON" ]]; then
  skip "$GATEWAY_JSON 已存在 → $(cat "$GATEWAY_JSON")"
else
  run mkdir -p "$(dirname "$GATEWAY_JSON")"
  if [[ $DRY_RUN == 0 ]]; then
    printf '{\n  "gateway": "official"\n}\n' >"$GATEWAY_JSON"
  fi
  ok "写入 $GATEWAY_JSON → official（默认网关，代码里也是这个默认值）"
fi

# -----------------------------------------------------------------------------
step "6/7 ~/.pi/agent/AGENTS.md 分工段"
# -----------------------------------------------------------------------------
AGENTS_BLOCK="$(cat <<'EOF'
## 判断 / 决策工具（Jev）

只有一个 Jev 工具 + 一个 CLI：

| 场景 | 用什么 |
|---|---|
| 结构化判断（noul/choice/score），单条或少量问题 | `jev` 工具 |
| 脚本 / reflex / 批量多问 | `~/.local/bin/jev` CLI（`@state.json` 传状态，`-q` 传问题，`-j` 出 JSON） |

- 结果里的 probability/confidence 是**判断，不是许可**，不构成执行授权。
- 网关默认 official 直连：`jev --status` 查看、`--status --check` 做活验证；切 OpenRouter 用 `jev --use openrouter`（或 `JEV_GATEWAY` 临时覆盖）。**模型名不跨网关通用**（official 认 `jev-latest`/`jev-preview`/`jev-1.13.0`，OpenRouter 认 `typesafe/jev-1.13`），要可复现就写死 `-m jev-1.13.0`。
- `~/.local/bin/jev` → jev-cli 仓库 `bin/jev` 的**软链**（单一事实源），改仓库文件即时生效；重跑 `install.sh` 不会覆盖。
- key 在 `~/.pi/agent/pi-typesafe/auth.json`（或 `TYPESAFE_API_KEY` 环境变量）。

### 已退役，勿再调用
`jev_triage`、`jev_route`、`typesafe_evaluate` 已移除；`jev-router`（按 prompt 概率性切模型）已删除。
替代：多候选决策 → `jev` 的 choice 问题；网页手段路由 → `web-control-router` skill；模型选择 → `autowrite-model-gate`（确定性硬锁）。**不要**用概率性判断去决定模型。
EOF
)"

if [[ $DO_AGENTS == 0 ]]; then
  skip "--no-agents，跳过"
elif [[ -f "$AGENTS_MD" ]] && grep -qF "$AGENTS_MARKER" "$AGENTS_MD"; then
  skip "$AGENTS_MD 已有 Jev 分工段"
else
  if [[ $DRY_RUN == 1 ]]; then
    printf '    %s[dry-run]%s 将把 Jev 分工段%s %s\n' "$D" "$N" \
      "$([[ -f "$AGENTS_MD" ]] && echo '追加到' || echo '写入')" "$AGENTS_MD"
  else
    run mkdir -p "$(dirname "$AGENTS_MD")"
    [[ -f "$AGENTS_MD" ]] && cp "$AGENTS_MD" "${AGENTS_MD}.bak-$(date +%Y%m%d-%H%M%S)"
    if [[ -f "$AGENTS_MD" && -s "$AGENTS_MD" ]]; then
      printf '\n%s\n' "$AGENTS_BLOCK" >>"$AGENTS_MD"    else
      printf '%s\n' "$AGENTS_BLOCK" >"$AGENTS_MD"
    fi
    ok "$AGENTS_MD 已更新"
  fi
fi

# -----------------------------------------------------------------------------
step "7/7 API key"
# -----------------------------------------------------------------------------
key_present() { [[ -n "${TYPESAFE_API_KEY:-}" ]] || { [[ -f "$TYPESAFE_AUTH" ]] && grep -q '"apiKey"' "$TYPESAFE_AUTH"; }; }

if [[ $DO_KEY == 0 ]]; then
  skip "--no-key，跳过（之后自己 export TYPESAFE_API_KEY）"
elif key_present; then
  skip "官方 key 已存在（$TYPESAFE_AUTH 或 TYPESAFE_API_KEY）"
elif [[ ! -t 0 ]]; then
  warn "非交互环境（管道/CI），无法提示输入 key"
  warn "请改用: export TYPESAFE_API_KEY=... 或交互式跑本脚本"
else
  printf '    官方直连 key（api.typesafe.ai）。留空跳过，之后可 export TYPESAFE_API_KEY。\n'
  printf '    %s输入不回显、不写入 shell 历史。%s\n' "$D" "$N"
  read -r -s -p "    TypeSafe API key: " ts_key || true
  printf '\n'
  if [[ -n "${ts_key:-}" ]]; then
    if [[ $DRY_RUN == 1 ]]; then
      printf '    %s[dry-run]%s 将写入 %s\n' "$D" "$N" "$TYPESAFE_AUTH"
    else
      mkdir -p "$(dirname "$TYPESAFE_AUTH")"
      python3 - "$TYPESAFE_AUTH" "$ts_key" <<'PY'
import json, os, sys
path, key = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    try:
        data = json.load(open(path, encoding="utf-8")) or {}
    except Exception:
        data = {}
data["apiKey"] = key
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
os.chmod(path, 0o600)
PY
      ok "官方 key 已写入 ${TYPESAFE_AUTH}（权限 600）"
    fi
    unset ts_key
  else
    skip "未输入，跳过"
  fi

  # OpenRouter key 可选：只有想切到 openrouter 网关才需要
  printf '    %s可选%s OpenRouter key（仅 `jev --use openrouter` 时需要，留空跳过）\n' "$D" "$N"
  read -r -s -p "    OpenRouter API key: " or_key || true
  printf '\n'
  if [[ -n "${or_key:-}" ]]; then
    if [[ $DRY_RUN == 1 ]]; then
      printf '    %s[dry-run]%s 将写入 %s\n' "$D" "$N" "$OPENROUTER_AUTH"
    else
      mkdir -p "$(dirname "$OPENROUTER_AUTH")"
      python3 - "$OPENROUTER_AUTH" "$or_key" <<'PY'
import json, os, sys
path, key = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    try:
        data = json.load(open(path, encoding="utf-8")) or {}
    except Exception:
        data = {}
data.setdefault("openrouter", {})["key"] = key
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
os.chmod(path, 0o600)
PY
      ok "OpenRouter key 已写入 $OPENROUTER_AUTH"
    fi
    unset or_key
  else
    skip "未输入，跳过（不影响官方直连）"
  fi
fi

# -----------------------------------------------------------------------------
step "自检"
# -----------------------------------------------------------------------------
if [[ $DRY_RUN == 1 ]]; then
  warn "dry-run 结束，未做任何修改"
  exit 0
fi

fail=0
printf '    pi 包:\n'
for p in "$REPO_GIT" "npm:pi-web-access"; do
  if pi list 2>/dev/null | grep -qF "$p"; then printf '      %s✓%s %s\n' "$G" "$N" "$p"; else printf '      %s✗%s %s\n' "$R" "$N" "$p"; fail=1; fi
done

printf '    网页/信息工具:\n'
for c in agent-browser; do
  if command -v "$c" >/dev/null 2>&1; then printf '      %s✓%s %s\n' "$G" "$N" "$c"; else printf '      %s✗%s %s（web-control-router 会用到但不可用）\n' "$Y" "$N" "$c"; fi
done
if [[ -f "$UF_DIR/pyproject.toml" ]]; then
  printf '      %s✓%s jev-ultrafast (%s)\n' "$G" "$N" "$UF_DIR"
  [[ -f "$UF_DIR/.env" ]] || printf '      %s!%s jev-ultrafast 缺 .env（需填密钥）\n' "$Y" "$N"
else
  printf '      %s!%s jev-ultrafast 未安装（web-control-router 会用到但不可用）\n' "$Y" "$N"
fi

if [[ -x "$CLI_LINK" ]]; then
  printf '      %s✓%s %s\n' "$G" "$N" "$CLI_LINK → $(readlink "$CLI_LINK" 2>/dev/null || echo '(普通文件)')"
else
  printf '      %s✗%s %s 不可执行\n' "$R" "$N" "$CLI_LINK"; fail=1
fi

if key_present || [[ -f "$TYPESAFE_AUTH" ]]; then
  printf '    %s活验证%s（免费 GET /v1/models）:\n' "$B" "$N"
  if check_out="$("$CLI_LINK" --check 2>&1)"; then
    printf '%s\n' "$check_out" | sed 's/^/      /'
  else
    # --check 未通过时 CLI 返回非 0（key 无效 / 端点不可达）
    printf '%s\n' "$check_out" | sed 's/^/      /'
    warn "活验证失败：key 无效或网络不通。官方 key 从 https://typesafe.ai 获取"
    fail=1
  fi
else
  warn "官方 key 未配置，跳过活验证"
  printf '      配置后运行: %sjev --status --check%s\n' "$B" "$N"
fi

printf '\n'
if [[ $fail == 0 ]]; then
  printf '%s安装完成，全部检查通过。%s\n' "$B$G" "$N"
else
  printf '%s安装完成，但有检查项未通过（见上，用 ✗ / ! 标出）。%s\n' "$B$Y" "$N"
  exit 1
fi
cat <<EOF

后续手动步骤
  1. 重启 pi，然后确认：
       /jev gateway          # 当前网关
       jev --status --check  # 命令行活验证
  2. 让 agent 实际调一次 `jev` 工具，确认已注册
  3. 若上面 jev-ultrafast 报缺 .env：在 $UF_DIR/.env 填密钥
       TYPESAFE_API_KEY=...（与 pi 的官方 key 可同一把）
       TEXT_MODEL_API_KEY=... TEXT_MODEL_BASE_URL=... TEXT_MODEL=...

日常用法
  jev "状态描述" -q 问题名:问题内容      # 单次判断
  jev --status / --check                # 看网关 / 活验证
  jev --use openrouter | jev --use official   # 切网关（所有调用点一起切）
  /jev gateway openrouter               # pi 内等价命令
EOF
