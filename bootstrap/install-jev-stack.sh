#!/usr/bin/env bash
# =============================================================================
# install-jev-stack.sh — 在一台新设备上装好整套 Jev 栈（幂等，可重复运行）
#
# 装什么（全部来自公网，无需从旧机器拷文件）：
#   1. pi 包 npm:pi-typesafe        → typesafe_evaluate 工具（官方直连批量判断）
#   2. pi 包 git:…/jev-cli          → jev / jev_triage / jev_route 三个工具
#   3. ~/.local/bin/jev 软链        → 指向 jev-cli 仓库 bin/jev（单一事实源）
#   4. ~/.bashrc 环境变量块         → PI_TYPESAFE_ENABLED=1 + 每日花费硬闸门
#   5. ~/.pi/agent/AGENTS.md 分工段 → 告诉 agent 什么场景用哪条通道
#   6. 网关默认值                   → jev-gateway.json = official
#
# 需要手动做的只有一件事：API key（脚本会提示输入，不会写进命令历史）。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/bootstrap/install-jev-stack.sh | bash
#   # 或在仓库里：
#   bash bootstrap/install-jev-stack.sh
#
# 选项：
#   --no-key      跳过 key 交互（稍后自己 /typesafe login 或 export TYPESAFE_API_KEY）
#   --no-agents   不写 ~/.pi/agent/AGENTS.md
#   --no-bashrc   不写 ~/.bashrc 环境变量
#   --dry-run     只打印将要做什么，不改任何东西
#   -h, --help    帮助
# =============================================================================
set -euo pipefail

REPO_SLUG="gmaxxxie/jev-cli"
REPO_GIT="git:github.com/${REPO_SLUG}"
REPO_URL="https://github.com/${REPO_SLUG}"
EXPECTED_REPO_DIR="${HOME}/.pi/agent/git/github.com/${REPO_SLUG}"
TYPESAFE_AUTH="${HOME}/.pi/agent/pi-typesafe/auth.json"
OPENROUTER_AUTH="${HOME}/.pi/agent/auth.json"
GATEWAY_JSON="${HOME}/.pi/agent/jev-gateway.json"
AGENTS_MD="${HOME}/.pi/agent/AGENTS.md"
BASHRC="${HOME}/.bashrc"
CLI_LINK="${HOME}/.local/bin/jev"

BASHRC_MARKER="# ===== pi-typesafe: 默认启用 Jev 批量判断工具 ====="
AGENTS_MARKER="## 判断 / 决策工具分工（Jev 双通道）"

DO_KEY=1 DO_AGENTS=1 DO_BASHRC=1 DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-key) DO_KEY=0 ;;
    --no-agents) DO_AGENTS=0 ;;
    --no-bashrc) DO_BASHRC=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $arg（-h 看帮助）" >&2; exit 2 ;;
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

printf '%s\n' "${B}整套 Jev 栈安装${N}  ${D}(pi-typesafe + jev-cli + CLI + 环境变量 + 分工文档)${N}"
[[ $DRY_RUN == 1 ]] && warn "dry-run 模式：只打印，不落盘"

# -----------------------------------------------------------------------------
step "1/7 预检依赖"
# -----------------------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || die "缺少 python3（jev CLI 是 Python 脚本）"
ok "python3 $(python3 -V 2>&1 | awk '{print $2}')"
command -v pi >/dev/null 2>&1 || die "缺少 pi（先装 @earendil-works/pi-coding-agent）"
ok "pi $(pi --version 2>/dev/null | head -1 || echo '(版本未知)')"
command -v git >/dev/null 2>&1 || die "缺少 git（pi install git:… 需要）"
ok "git $(git --version | awk '{print $3}')"

# -----------------------------------------------------------------------------
step "2/7 安装 pi 包"
# -----------------------------------------------------------------------------
installed_pkgs="$(pi list 2>/dev/null || true)"
has_pkg() { grep -qF "$1" <<<"$installed_pkgs"; }

if has_pkg "npm:pi-typesafe"; then
  skip "npm:pi-typesafe 已安装"
else
  run pi install npm:pi-typesafe
  ok "npm:pi-typesafe 已安装"
fi

if has_pkg "$REPO_GIT"; then
  skip "$REPO_GIT 已安装"
else
  run pi install "$REPO_GIT"
  ok "$REPO_GIT 已安装"
fi

# -----------------------------------------------------------------------------
step "3/7 定位仓库并建 CLI 软链"
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

for f in bin/jev extension/jev.ts extension/jev-triage.ts extension/jev-route.ts; do
  [[ $DRY_RUN == 1 || -f "$REPO_DIR/$f" ]] || die "仓库缺少 $f（拉到的版本不对？）"
done
ok "三个扩展 + CLI 脚本齐全"

# 复用仓库自带 install.sh 的软链逻辑（它本地运行时会 ln -sf 而不是 cp）
run env JEV_SKIP_KEY=1 INSTALL_CLI=1 bash "$REPO_DIR/install.sh"
if [[ -L "$CLI_LINK" ]]; then
  ok "软链: $CLI_LINK → $(readlink "$CLI_LINK")"
elif [[ -e "$CLI_LINK" ]]; then
  warn "$CLI_LINK 是普通文件（旧版拷贝安装），已由 install.sh 覆盖为软链"
else
  [[ $DRY_RUN == 1 ]] || die "软链未创建：$CLI_LINK"
fi
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ok "~/.local/bin 已在 PATH 中" ;;
  *) warn "~/.local/bin 不在 PATH：请把 'export PATH=\"\$HOME/.local/bin:\$PATH\"' 加进 ~/.bashrc" ;;
esac

# -----------------------------------------------------------------------------
step "4/7 网关默认值"
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
step "5/7 ~/.bashrc 环境变量（每日花费硬闸门）"
# -----------------------------------------------------------------------------
# 必须放在 interactive guard 之前：否则无头 pi / 子 agent 拿不到这些变量，
# typesafe_evaluate 会静默退回“需会话内手动 enable”。
BASHRC_BLOCK="$(cat <<'EOF'
# ===== pi-typesafe: 默认启用 Jev 批量判断工具 =====
# 无此变量时，typesafe_evaluate 仅在会话内 /typesafe enable 后可用（无头/子 agent 会静默失去判断能力）。
# 密钥来自 ~/.pi/agent/pi-typesafe/auth.json（/typesafe login 写入），未设置则不生效。
# 注意：必须放在 interactive guard 之前，否则非交互 shell（无头 pi、子 agent）拿不到。
export PI_TYPESAFE_ENABLED=1
# 每日硬闸门（超出则请求在发出前被拒；计数器持久化在 ~/.pi/agent/pi-typesafe/usage.json）
# 计价 $0.042/1M input，故 $0.5/天 ≈ 1200 万 input tokens ≈ 数千次典型调用。
export PI_TYPESAFE_MAX_USD_PER_DAY=0.5
export PI_TYPESAFE_MAX_REQUESTS_PER_DAY=500
export PI_TYPESAFE_MAX_INPUT_TOKENS_PER_DAY=12000000
EOF
)"

if [[ $DO_BASHRC == 0 ]]; then
  skip "--no-bashrc，跳过"
elif [[ -f "$BASHRC" ]] && grep -qF "$BASHRC_MARKER" "$BASHRC"; then
  skip "$BASHRC 已有 pi-typesafe 块"
else
  if [[ $DRY_RUN == 1 ]]; then
    printf '    %s[dry-run]%s 将把环境变量块插入 %s 的 interactive guard 之前\n' "$D" "$N" "$BASHRC"
  else
    [[ -f "$BASHRC" ]] || : >"$BASHRC"
    cp "$BASHRC" "${BASHRC}.bak-$(date +%Y%m%d-%H%M%S)"
    python3 - "$BASHRC" "$BASHRC_BLOCK" <<'PY'
import re, sys
path, block = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().split("\n")
# interactive guard 的几种常见写法，插到第一个之前
guard = re.compile(r'^\s*(case\s+\$-|\[\[\s*\$-\s*!=|\[\s*-z\s*"\$PS1"|\[\[\s*-z\s*"\$PS1")')
idx = next((i for i, l in enumerate(lines) if guard.match(l)), None)
out = lines[:idx] + block.split("\n") + [""] + lines[idx:] if idx is not None else lines + ["", block]
open(path, "w", encoding="utf-8").write("\n".join(out))
print(f"    插入位置: 第 {idx + 1 if idx is not None else len(lines) + 2} 行"
      f"{'（interactive guard 之前）' if idx is not None else '（文件末尾）'}")
PY
    ok "$BASHRC 已更新（备份见 ${BASHRC}.bak-*）"
    warn "当前 shell 未生效：新开终端，或 source ~/.bashrc"
  fi
fi

# -----------------------------------------------------------------------------
step "6/7 ~/.pi/agent/AGENTS.md 分工段"
# -----------------------------------------------------------------------------
AGENTS_BLOCK="$(cat <<'EOF'
## 判断 / 决策工具分工（Jev 双通道）

本机有两条 Jev 通道，模型和价格相同（$0.042/1M input，output 免费），差别在网关与封装。**按用途选，不要凭习惯选**：

| 场景 | 用什么 |
|---|---|
| 批量结构化判断：一次分类/评分/筛选多个对象（≤32 问） | `typesafe_evaluate`（走 `api.typesafe.ai`，官方直连，带花费上限） |
| 单条状态做少量判断 | `typesafe_evaluate`（同上，避免多开一条链路） |
| 「接下来做哪一项」多候选决策支持 | `jev_triage`（带规则层与优劣势，Jev 失败自动降级） |
| 网页/信息手段路由 | `jev_route`（内置本机工具清单 + 确定性规则层） |
| reflex / 本地脚本调用 | `~/.local/bin/jev` CLI（不要改成别的） |

- 不要为同一件事同时调两个通道；`typesafe_evaluate` 是多问批量首选，`jev` 自由问答仅在需要非结构化探测时用。
- `typesafe_evaluate` 默认禁用，需 `/typesafe enable` 或 `PI_TYPESAFE_ENABLED=1`；结果里的 probability/confidence 是判断，不是许可，不构成执行授权。
- **网关可切（默认 official）**：`jev`/`jev_triage`/`jev_route`/reflex/AutoWriteO 都走 `~/.local/bin/jev`，默认官方直连；需要 OpenRouter 时用 `jev --use openrouter`（`jev --status` 查看，`jev --status --check` 做活验证，`JEV_GATEWAY` 临时覆盖）。两条通道同模型同价（$0.042/1M input）。
- **模型名不跨网关通用**：官方只认 `jev-latest`/`jev-preview`/`jev-1.13.0`，OpenRouter 只认 `typesafe/jev-1.13`。混用会被 CLI 提前拒绝（不是等 API 报 400）。要可复现就写死 `-m jev-1.13.0`，`jev-latest` 是浮动标签。
- `~/.local/bin/jev` 是指向 jev-cli 仓库 `bin/jev` 的**软链**（单一事实源），改仓库文件即时生效；重跑 `install.sh` 不会覆盖。
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
      printf '\n%s\n' "$AGENTS_BLOCK" >>"$AGENTS_MD"
    else
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
  skip "--no-key，跳过（之后自己 /typesafe login 或 export TYPESAFE_API_KEY）"
elif key_present; then
  skip "官方 key 已存在（$TYPESAFE_AUTH 或 TYPESAFE_API_KEY）"
elif [[ ! -t 0 ]]; then
  warn "非交互环境（管道/CI），无法提示输入 key"
  warn "请改用: export TYPESAFE_API_KEY=... 或交互式跑本脚本"
else
  printf '    官方直连 key（api.typesafe.ai）。留空跳过，之后可用 /typesafe login。\n'
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
      ok "官方 key 已写入 $TYPESAFE_AUTH（权限 600）"
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
for p in "npm:pi-typesafe" "$REPO_GIT"; do
  if pi list 2>/dev/null | grep -qF "$p"; then printf '      %s✓%s %s\n' "$G" "$N" "$p"; else printf '      %s✗%s %s\n' "$R" "$N" "$p"; fail=1; fi
done

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
  1. 新开一个终端（或 source ~/.bashrc）让 PI_TYPESAFE_* 生效
  2. 重启 pi，然后确认：
       /jev gateway          # 当前网关
       jev --status --check  # 命令行活验证
  3. 让 agent 实际调一次 typesafe_evaluate，确认工具已注册

日常用法
  jev "状态描述" -q 问题名:问题内容      # 单次判断
  jev --status / --check                # 看网关 / 活验证
  jev --use openrouter | jev --use official   # 切网关（所有调用点一起切）
  /jev gateway openrouter               # pi 内等价命令
EOF
