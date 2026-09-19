# jev-cli

> 中文版：[README.zh.md](README.zh.md)

A CLI for the [TypeSafe Jev System One](https://typesafe.ai) decision model — defaulting to the **TypeSafe direct API** (`api.typesafe.ai`), with [OpenRouter Decisions](https://openrouter.ai/docs/features/decisions) as a switchable alternative — plus two pi extensions: `jev` (structured decisions) and `jev_triage` (multi-candidate decision support).

## What it is

Feed it a program/business state description and Jev quickly returns structured decisions instead of long prose:

| Type | Meaning | Returns |
|------|---------|---------|
| `noul` | Binary judgment | P(true) ∈ [0,1] |
| `choice` | Pick one of several options | Chosen key + per-option probabilities |
| `score` | Ordered rating (N criteria levels) | Float in 0..(N-1) + confidence |

Typical uses: routing, classification, urgency gating, workflow gate decisions.

## Dependencies

- Python 3 (stdlib only: `argparse`/`json`/`urllib`, no third-party packages)
- A TypeSafe API key (default, for `api.typesafe.ai`) **or** an OpenRouter API key (if you switch to that gateway)
- (Optional) [pi](https://github.com/earendil-works/pi-coding-agent) — only needed for the pi extensions

## Install

Three things: the CLI script, the pi extensions (`jev` + `jev_triage`), and an API key.

### One-shot install

```bash
curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/install.sh | bash
```

Or clone and run locally:

```bash
git clone git@github.com:gmaxxxie/jev-cli.git /tmp/jev-cli
bash /tmp/jev-cli/install.sh
```

### Install as a pi package (git source)

```bash
pi install git:github.com/gmaxxxie/jev-cli
```

The package registers both extensions (`jev`, `jev_triage`). No version ref = follow `main`; update anytime with:

```bash
pi update --extensions
```

To pin a specific release instead, append a tag: `pi install git:github.com/gmaxxxie/jev-cli@v1.0.0`.

### 手动安装

```bash
# 1. CLI script — symlink when installing from a local clone so there is one source of truth
mkdir -p ~/.local/bin
ln -sf "$PWD/bin/jev" ~/.local/bin/jev

# ...or `bash install.sh`, which symlinks automatically when run inside the repo
# and only falls back to a copy for the `curl | bash` network install.
# If you already have a copy, replace it: install.sh would otherwise overwrite local edits.

# 2. pi extensions — use the pi package instead of copying to ~/.pi/agent/extensions
#    (copying would conflict with the package's same-named tools)
pi install git:github.com/gmaxxxie/jev-cli

# 3. API key — resolved per gateway, highest priority first
#    official (default):
#      a. TYPESAFE_API_KEY environment variable
#      b. ~/.pi/agent/pi-typesafe/auth.json  {"apiKey": "..."}   (pi: /typesafe login)
#    openrouter (alternative):
#      a. OPENROUTER_API_KEY environment variable
#      b. ~/.pi/agent/auth.json  {"openrouter": {"key": "sk-or-xxx"}}
#    both: --key / JEV_API_KEY override everything
```

## Usage

```bash
# Simplest: binary judgment (noul by default)
jev "database primary CPU 95%" -q urgent:需要立即处理吗?

# choice: pick one option (criteria object, order is what the model sees)
jev "request hit routing layer" -q '{"region":{"type":"choice",\
  "instructions":"select region",\
  "criteria":{"us-east":"美东","eu-west":"欧洲","ap-east":"亚太"}}}'

# score: ordered rating (N criteria levels, returns 0..N-1 float)
jev "customer ticket is heated" -q '{"anger":{"type":"score",\
  "instructions":"anger level",\
  "criteria":["平静","有些不满","明显生气","威胁要取消"]}}'

# Read state from file
jev @state.txt -q ok:一切正常吗?

# Full JSON output (includes usage/cost)
jev "payout failed 3x in a row" -q '{"urgent":{"type":"noul",\
  "instructions":"This is urgent",\
  "criteria":{"true":"需立即介入","false":"可稍后处理"}}}' -j
```

### CLI flags

| Flag | Description | Default |
|------|-------------|---------|
| `state` | State description; `@` prefix reads from file; otherwise reads stdin | — |
| `-q` | Question, repeatable; `name:instructions` shorthand or full JSON | defaults to is_urgent |
| `-g` | Gateway: `official` \| `openrouter` | `~/.pi/agent/jev-gateway.json`, else `official` |
| `-m` | Model ID | per gateway (`typesafe/jev-1.13` / `jev-latest`) |
| `-e` | Endpoint | per gateway |
| `--key` | Explicit API key | env / auth file (per gateway) |
| `--use <gw>` | Switch the persisted default gateway, then exit | — |
| `--status` | Show resolved gateway / endpoint / model / key availability, then exit | — |
| `--check` | With `--status`: live-verify the key with a free GET + list available models | — |
| `-t` | Timeout seconds | 60 |
| `-j` | Raw JSON output | — |

### Gateways (TypeSafe direct vs OpenRouter)

Two interchangeable paths to the same model at the same price ($0.042/1M input, output free) — only the gateway differs. **The default is `official`** (TypeSafe direct); switch to OpenRouter when you want that route.

| Gateway | Endpoint | Model | Key source |
|---------|----------|-------|------------|
| `official` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` | `TYPESAFE_API_KEY` → `~/.pi/agent/pi-typesafe/auth.json` `apiKey` |
| `openrouter` | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` | `OPENROUTER_API_KEY` → `~/.pi/agent/auth.json` `openrouter.key` |

```bash
jev --status              # which gateway is active
jev --check               # live-verify: key really works + list available models
jev --use openrouter      # switch to OpenRouter (persisted)
jev --use official        # switch back to TypeSafe direct
```

`--status` only checks that a key *exists*; `--check` makes one free request (`GET /v1/models` on the official gateway, `GET /api/v1/key` on OpenRouter) to confirm the key is accepted and the endpoint is reachable — the same failure mode pi-typesafe's README warns about (an enabled tool with a dead key looks identical to a working one).

**Model names are not portable across gateways.** The official API rejects `typesafe/jev-1.13` with `400 Unknown model`; OpenRouter does not serve `jev-latest`. The CLI refuses the mismatch up front instead of letting the API 400:

```
$ jev "..." -q ok:ok? -m typesafe/jev-1.13
模型/网关不匹配：模型 'typesafe/jev-1.13' 是 OpenRouter 的命名（typesafe/…），官方直连不认；
用 jev-latest / jev-preview / jev-1.13.0，或切回 -g openrouter
```

Verified on the official gateway: `jev-latest` → 200, `jev-1.13.0` → 200, `jev-1.13` → 400. `jev-latest` is a floating tag (currently resolves to `jev-1.13.0`), so pin `-m jev-1.13.0` when a judgment must be reproducible.

If `-m` / `-e` / `$JEV_MODEL` / `~/.pi/agent/jev-config.json` overrides a gateway preset, the CLI prints a note on **stderr** (it never blocks) — stdout stays clean so callers that parse `--json` output are unaffected.

Resolution order (high → low): CLI flag (`-g` / `-e` / `-m`) > env (`JEV_GATEWAY` / `JEV_ENDPOINT` / `JEV_MODEL`) > `~/.pi/agent/jev-gateway.json` > default `official`. The request body and response shape are identical on both paths; only `provider` and `usage.cost` are OpenRouter-only extras (the CLI estimates cost from input tokens when absent).

Because `jev`, `jev_triage`, `jev_route`, `dual-gate/reflex`, and AutoWriteO's `jev_bridge` all shell out to this one CLI, switching the gateway once switches all of them.

## pi extensions

### `jev` — structured decision tool

Registers a `jev` tool for pi: input `state` + `questions`, returns structured judgments. For routing, classification, gate prescreening, etc.

```jsonc
// tool exposed to the LLM inside pi
jev(state: "database primary CPU 95%",
    questions: { urgent: { type: "noul", instructions: "需要立即处理吗?" } })
```

### `/jev` — interactive config command

Registers a `/jev` slash command for configuring the CLI defaults inside pi:

- `/jev` — show current config and usage
- `/jev config` — interactive wizard (gateway, model, endpoint, timeout, default question, API key)
- `/jev gateway [official|openrouter]` — show or switch the gateway (writes `~/.pi/agent/jev-gateway.json`)
- `/jev show` — show the current config as JSON
- `/jev reset` — restore defaults (delete config file)

Config is stored in `~/.pi/agent/jev-config.json` (gateway / model / endpoint / timeoutMs / defaultQuestion). The API key is resolved by the CLI per gateway (see [Gateways](#gateways-typesafe-direct-vs-openrouter)); `install.sh` only ever wrote the OpenRouter one. The `jev` tool reads this config and passes `-g` / `-m` / `-e` / `-t` to the CLI, so defaults you set here apply to LLM-driven calls too.

`/jev gateway [official|openrouter]` reads and writes the **same** `~/.pi/agent/jev-gateway.json` as `jev --use`, so the extension and the CLI cannot drift apart. Switching also drops any `model` / `endpoint` from `jev-config.json` that belonged to the other gateway (they would otherwise outrank the preset and cause a 400).

### `jev_route` — web/information-tool routing

The routing inventory (`fetch_content` / `web_search` / `agent-browser` / `jev-ultrafast`) is
**hardcoded on purpose** — the caller does not supply it, so routing stays reproducible when no
human reviews the choice. The flip side: the inventory can drift from what the device actually has.

So each entry is probed at call time and the missing ones are marked:

```
### 本机未安装（已从候选中剔除）
- `fetch_content` — 装法: pi install npm:pi-web-access
- `jev-ultrafast` — 装法: git clone https://github.com/browser-use/jev-ultrafast ~/Project/jev-ultrafast && uv sync
```

Missing tools are dropped from the Jev candidate list, and when the recommended pick is itself
unavailable the output carries an explicit install hint rather than a recommendation that would
fail on use. `details.available` / `details.missing_tools` expose the same data to callers.
Probe override: `JEV_ULTRAFAST_DIR` (default `~/Project/jev-ultrafast`).

### `jev_triage` — multi-candidate decision support

When pi replies with a multi-choice decision moment like "📋 待办（文档已记录）…需要我继续做哪一项吗?", pi calls `jev_triage`:

```jsonc
// tool exposed to the LLM inside pi
jev_triage(context: "Jev 集成 v1.3 已落地，剩余三项收尾待办",
           candidates: ["回放 E1 一致性", "E1 对接 audit_chain", "接线 autowrite CLI"])
```

It outputs a decision-support report:

1. **Candidate comparison (rule-based signals)** — extracts dependencies/cost/status from candidate text
2. **Jev score ranking** — one `score` per candidate (mapped to 0-10 + confidence)
3. **Recommended pick** — Jev `choice` selects the best one
4. **Top-3 pros/cons** — `noul` judgments of advantage/risk per candidate (P values)

On Jev failure/timeout it falls back to the rule-based comparison — never blocks. Consider adding a line to your `AGENTS.md` so pi calls it proactively at decision moments.

## 安装到新设备（整套 Jev 栈）

在一台新机器上复现本机的完整 Jev 环境（`typesafe_evaluate` + `jev` + `jev_triage` + `jev_route` + 每日花费闸门 + agent 分工文档）：

```bash
curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/bootstrap/install-jev-stack.sh | bash
```

或在仓库里跑：

```bash
bash bootstrap/install-jev-stack.sh
```

脚本是**幂等**的（可重复运行，不会重复追加配置），会做八件事：

1. 预检 `python3` / `pi` / `git`
2. `pi install npm:pi-typesafe` + `pi install git:github.com/gmaxxxie/jev-cli`（已装则跳过）
3. 安装 `jev_route` 路由清单里那四个工具：`npm:pi-web-access`（`fetch_content` / `web_search`）、`npm i -g agent-browser`、以及 `git clone` + `uv sync` 的 `jev-ultrafast`
4. 定位仓库并建 `~/.local/bin/jev` 软链（复用 `install.sh`，网络安装时自动 `git clone` 到 `~/.local/share/jev-cli`）
5. 写 `~/.pi/agent/jev-gateway.json` → `official`
6. 把 `PI_TYPESAFE_ENABLED=1` + 三个每日上限插进 `~/.zshrc` / `~/.bashrc` / `~/.profile` 的 **interactive guard 之前**（否则无头 pi / 子 agent 拿不到）
7. 把「Jev 双通道分工」段写进 `~/.pi/agent/AGENTS.md`
8. 交互式提示输入 API key（**不回显、不进 shell 历史**），然后用一次免费 `GET /v1/models` 做活验证

rc 文件按 `$SHELL` 选：macOS 默认 zsh，**不读 `~/.bashrc`**，写错文件会让 `typesafe_evaluate` 静默保持禁用。

选项：`--update`（刷新已装的）、`--no-key`（跳过 key，之后自己 `/typesafe login`）、`--no-agents`、`--no-bashrc`、`--dry-run`。

**只有 API key 和 `jev-ultrafast/.env` 需要人工处理。** 其余全部来自公网（GitHub + npm），不需要从旧机器拷文件。脚本失败时返回非 0 退出码（`--check` 活验证不通过也会返回 1），可用于 CI / 自动化。

### 升级已有旧版的设备

两层，互相独立：

```bash
pi update --extensions                      # pi 包（npm 与 git 源都支持）
curl -fsSL .../bootstrap/install-jev-stack.sh | bash -s -- --update   # bootstrap 管的部分
```

只跑 `pi update --extensions` 不够：它只更新包，**不会**补上 bootstrap 负责的那些东西。重跑
bootstrap 才会装上前版没有的路由目标工具、并修好前版写错位置的配置。注意 `pi update` 不带参数
时**只更新 pi 本身**，扩展要加 `--extensions`。

`--update` 让脚本刷新已装的东西；不加时只装缺的，所以重复运行不会静默升级你的包。

有一处会自动修复：旧版把 rc 文件写死 `~/.bashrc`，在 zsh 机器上那个 `PI_TYPESAFE_*` 块落在 zsh
根本不读的文件里，`typesafe_evaluate` 一直静默禁用。升级时脚本会把那个块注释掉（注明原因、留备份），
再写到正确的 rc 文件。没有这步的话，两个文件都会说"已有块"，结果谁都不修。

安装后需要：新开终端（让环境变量生效）+ 重启 pi。验证：

```bash
jev --status --check      # 网关 + key 活验证
/jev gateway              # pi 内查看当前网关
```

## Installing on a new device (full stack)

To reproduce the complete Jev environment (`typesafe_evaluate` + `jev` + `jev_triage` + `jev_route` + daily spend caps + the agent-facing routing doc) on another machine:

```bash
curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/bootstrap/install-jev-stack.sh | bash
```

Or from a clone: `bash bootstrap/install-jev-stack.sh`.

The script is **idempotent** (safe to re-run; it will not append duplicate config) and performs eight steps:

1. Preflight `python3` / `pi` / `git`
2. `pi install npm:pi-typesafe` + `pi install git:github.com/gmaxxxie/jev-cli` (skipped if present)
3. Install the tools that `jev_route` routes to: `npm:pi-web-access` (`fetch_content` / `web_search`), `npm install -g agent-browser`, and `git clone` + `uv sync` of `jev-ultrafast`
4. Locate the repo and symlink `~/.local/bin/jev` (reuses `install.sh`; falls back to `git clone` into `~/.local/share/jev-cli` for the network install)
5. Write `~/.pi/agent/jev-gateway.json` → `official`
6. Insert `PI_TYPESAFE_ENABLED=1` + the three daily caps into `~/.zshrc` / `~/.bashrc` / `~/.profile` **before the interactive guard** (otherwise headless pi / sub-agents never see them)
7. Add the "Jev dual-channel routing" section to `~/.pi/agent/AGENTS.md`
8. Prompt for the API key (no echo, never in shell history), then live-verify it with one free `GET /v1/models`

The rc file is chosen from `$SHELL`: macOS defaults to zsh and never reads `~/.bashrc`, so writing the caps there would silently leave `typesafe_evaluate` disabled.

Flags: `--update` (refresh what is already installed), `--no-key` (skip key entry, use `/typesafe login` later), `--no-agents`, `--no-bashrc`, `--dry-run`.

**Only the API key and `jev-ultrafast/.env` need manual handling.** Everything else comes from the public internet (GitHub + npm) — no need to copy files off the old machine. The script exits non-zero on failure (including a failing `--check` live verification), so it is safe to use in CI / automation.

### Updating a device that already has an older version

Two layers, and they are independent:

```bash
pi update --extensions                      # pi packages (both npm + git sources)
curl -fsSL .../bootstrap/install-jev-stack.sh | bash -s -- --update   # bootstrap-managed bits
```

`pi update --extensions` alone refreshes the packages but **not** the things the bootstrap owns, so
it is not enough to move an old device to the current version. Re-running the bootstrap picks up
what the old version never installed (the `jev_route` target tools) and repairs the config it wrote
to the wrong place. Note `pi update` with no flags updates **pi itself only** — extensions need
`--extensions`.

`--update` makes the bootstrap refresh what is already present; without it the script only installs
what is missing, so a re-run never silently upgrades your packages.

One repair is automatic: versions before this one hardcoded `~/.bashrc`, so on a zsh machine the
`PI_TYPESAFE_*` block landed in a file zsh never reads and `typesafe_evaluate` stayed silently
disabled. On upgrade the bootstrap comments that block out (labelled with the reason, backed up)
and writes the real one to the correct rc file. Without this, both files would report "block already
present" and neither would be fixed.

Afterwards: open a new terminal (so the env vars apply) and restart pi. Verify with:

```bash
jev --status --check      # gateway + live key check
/jev gateway              # show current gateway inside pi
```

## Repository layout

```
jev-cli/
├── bin/                jev CLI script (single-file Python)
├── extension/          pi extensions
│   ├── jev.ts          structured decision tool
│   ├── jev-route.ts    web/information-tool routing tool
│   └── jev-triage.ts   multi-candidate decision support tool
├── bootstrap/
│   └── install-jev-stack.sh   full-stack installer for a new device
├── install.sh          one-shot installer (INSTALL_CLI switch; CLI + API key guide)
├── package.json        pi package manifest (git source)
├── README.md           (English)
└── README.zh.md        (中文版)
```

## License

MIT
