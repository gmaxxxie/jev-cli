# jev-cli

A CLI for the [TypeSafe Jev System One](https://typesafe.ai) decision model — defaulting to the **TypeSafe direct API** (`api.typesafe.ai`), with [OpenRouter Decisions](https://openrouter.ai/docs/features/decisions) and a self-hosted **NewAPI** Jev gateway (`http://127.0.0.1:3000`) as switchable alternatives — plus a pi extension: `jev` (structured decisions).

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
- A TypeSafe API key (default, for `api.typesafe.ai`) **or** an OpenRouter API key (if you switch to that gateway) **or** a key for your NewAPI Jev gateway (if you switch to `newapi`)
- (Optional) [pi](https://github.com/earendil-works/pi-coding-agent) — only needed for the pi extensions

## Install

Two things: the CLI script (with its optional `jev` pi extension) and an API key.

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

The package registers the `jev` extension. No version ref = follow `main`; update anytime with:

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
#      b. ~/.pi/agent/pi-typesafe/auth.json  {"apiKey": "..."}   (jev CLI 读取；pi-typesafe 扩展已退役)
#    openrouter (alternative):
#      a. OPENROUTER_API_KEY environment variable
#      b. ~/.pi/agent/auth.json  {"openrouter": {"key": "sk-or-xxx"}}
#    newapi (alternative, self-hosted Jev gateway):
#      a. JEV_API_KEY environment variable (no gateway-specific env var)
#      b. ~/.pi/agent/auth.json  {"new-api": {"key": "sk-xxx"}}
#    all gateways: --key / JEV_API_KEY override everything
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
| `-g` | Gateway: `official` \| `openrouter` \| `newapi` | `~/.pi/agent/jev-gateway.json`, else `official` |
| `-m` | Model ID | per gateway (`jev-latest` / `typesafe/jev-1.13` / `jev-1.13.0`) |
| `-e` | Endpoint | per gateway |
| `--key` | Explicit API key | env / auth file (per gateway) |
| `--use <gw>` | Switch the persisted default gateway, then exit | — |
| `--status` | Show resolved gateway / endpoint / model / key availability, then exit | — |
| `--check` | With `--status`: live-verify the key with a free GET + list available models | — |
| `-t` | Timeout seconds | 60 |
| `-j` | Raw JSON output | — |

### Gateways (TypeSafe direct vs OpenRouter vs NewAPI)

Three switchable paths to Jev: the official TypeSafe direct API and OpenRouter serve the same model at the same price ($0.042/1M input, output free) — only the gateway differs — plus a self-hosted NewAPI Jev gateway on `http://127.0.0.1:3000` (its billing is whatever that gateway is configured with; the CLI does not assume a price for it). **The default is `official`** (TypeSafe direct); switch when you want another route.

| Gateway | Endpoint | Model | Key source |
|---------|----------|-------|------------|
| `official` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` | `TYPESAFE_API_KEY` → `~/.pi/agent/pi-typesafe/auth.json` `apiKey` |
| `openrouter` | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` | `OPENROUTER_API_KEY` → `~/.pi/agent/auth.json` `openrouter.key` |
| `newapi` | `http://127.0.0.1:3000/typesafe/v1/systemone` | `jev-1.13.0` | `JEV_API_KEY` → `~/.pi/agent/auth.json` `new-api.key` |

```bash
jev --status              # which gateway is active
jev --check               # live-verify: key really works + list available models
jev --use openrouter      # switch to OpenRouter (persisted)
jev --use newapi          # switch to the NewAPI Jev gateway (persisted)
jev --use official        # switch back to TypeSafe direct
```

`--status` only checks that a key *exists*; `--check` makes one free request (`GET /v1/models` on the official gateway and on `newapi`; `GET /api/v1/key` on OpenRouter) to confirm the key is accepted and the endpoint is reachable — the same failure mode pi-typesafe's README warns about (an enabled tool with a dead key looks identical to a working one).

**Model names are not portable across gateways.** The official API rejects `typesafe/jev-1.13` with `400 Unknown model`; OpenRouter does not serve `jev-latest`. The `newapi` gateway keeps the official `jev-…` naming (default `jev-1.13.0`) and also rejects `typesafe/…`. The CLI refuses the mismatch up front instead of letting the API 400:

```
$ jev "..." -q ok:ok? -m typesafe/jev-1.13
模型/网关不匹配：模型 'typesafe/jev-1.13' 是 OpenRouter 的命名（typesafe/…），官方直连不认；
用 jev-latest / jev-preview / jev-1.13.0，或切回 -g openrouter
```

Verified on the official gateway: `jev-latest` → 200, `jev-1.13.0` → 200, `jev-1.13` → 400. `jev-latest` is a floating tag (currently resolves to `jev-1.13.0`), so pin `-m jev-1.13.0` when a judgment must be reproducible.

If `-m` / `-e` / `$JEV_MODEL` / `~/.pi/agent/jev-config.json` overrides a gateway preset, the CLI prints a note on **stderr** (it never blocks) — stdout stays clean so callers that parse `--json` output are unaffected.

Resolution order (high → low): CLI flag (`-g` / `-e` / `-m`) > env (`JEV_GATEWAY` / `JEV_ENDPOINT` / `JEV_MODEL`) > `~/.pi/agent/jev-gateway.json` > default `official`. The request body and response shape are the same on every path (each gateway still gets a `POST` to its `systemone`/decisions endpoint — `newapi` is never called via `/v1/chat/completions`); only `provider` and `usage.cost` are OpenRouter-only extras (the CLI estimates cost from input tokens when absent).

Because `jev`, `dual-gate/reflex`, and AutoWriteO's `jev_bridge` all shell out to this one CLI, switching the gateway once switches all of them.

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
- `/jev gateway [official|openrouter|newapi]` — show or switch the gateway (writes `~/.pi/agent/jev-gateway.json`)
- `/jev show` — show the current config as JSON
- `/jev reset` — restore defaults (delete config file)

Config is stored in `~/.pi/agent/jev-config.json` (gateway / model / endpoint / timeoutMs / defaultQuestion). The API key is resolved by the CLI per gateway (see [Gateways](#gateways-typesafe-direct-vs-openrouter-vs-newapi)); the wizard's "input/clear key" steps write the key for the selected gateway only (`official` → `pi-typesafe/auth.json` `apiKey`, `openrouter` → `auth.json` `openrouter.key`, `newapi` → `auth.json` `new-api.key`), leaving the other entries in `auth.json` untouched. The `jev` tool reads this config and passes `-g` / `-m` / `-e` / `-t` to the CLI, so defaults you set here apply to LLM-driven calls too.

`/jev gateway [official|openrouter|newapi]` reads and writes the **same** `~/.pi/agent/jev-gateway.json` as `jev --use`, so the extension and the CLI cannot drift apart. Switching also drops any `model` / `endpoint` from `jev-config.json` that belonged to the other gateway (they would otherwise outrank the preset and cause a 400).

### Retired extensions

`jev_route` (web/information-tool routing) and `jev_triage` (multi-candidate decision support)
were removed in 2026-09. Web/information routing now lives in the `web-control-router` skill;
multi-candidate decisions are a plain `choice` question on the `jev` tool. Both are recoverable
from git history.

## 安装到新设备（整套 Jev 栈）

在一台新机器上复现本机的完整 Jev 环境（`jev` CLI + `jev` 工具 + 网页/信息工具 + agent 分工文档）：

```bash
curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/bootstrap/install-jev-stack.sh | bash
```

或在仓库里跑：

```bash
bash bootstrap/install-jev-stack.sh
```

脚本是**幂等**的（可重复运行，不会重复追加配置），会做七件事：

1. 预检 `python3` / `pi` / `git`
2. `pi install git:github.com/gmaxxxie/jev-cli`（已装则跳过）
3. 安装网页/信息工具：`npm:pi-web-access`（`fetch_content` / `web_search`）、`npm i -g agent-browser`、以及 `git clone` + `uv sync` 的 `jev-ultrafast`
4. 定位仓库并建 `~/.local/bin/jev` 软链（复用 `install.sh`，网络安装时自动 `git clone` 到 `~/.local/share/jev-cli`）
5. 写 `~/.pi/agent/jev-gateway.json` → `official`
6. 把「Jev 判断/决策工具」段写进 `~/.pi/agent/AGENTS.md`
7. 交互式提示输入 API key（**不回显、不进 shell 历史**），然后用一次免费 `GET /v1/models` 做活验证

选项：`--update`（刷新已装的）、`--no-key`（跳过 key，之后自己 `export TYPESAFE_API_KEY`）、`--no-agents`、`--dry-run`。（`--no-bashrc` 已废弃：rc 环境变量块随 pi-typesafe 扩展一并退役。）

**只有 API key 和 `jev-ultrafast/.env` 需要人工处理。** 其余全部来自公网（GitHub + npm），不需要从旧机器拷文件。脚本失败时返回非 0 退出码（`--check` 活验证不通过也会返回 1），可用于 CI / 自动化。

### 升级已有旧版的设备

两层，互相独立：

```bash
pi update --extensions                      # pi 包（npm 与 git 源都支持）
curl -fsSL .../bootstrap/install-jev-stack.sh | bash -s -- --update   # bootstrap 管的部分
```

只跑 `pi update --extensions` 不够：它只更新包，**不会**补上 bootstrap 负责的那些东西。重跑
bootstrap 才会装上前版没有的网页/信息工具。注意 `pi update` 不带参数
时**只更新 pi 本身**，扩展要加 `--extensions`。

`--update` 让脚本刷新已装的东西；不加时只装缺的，所以重复运行不会静默升级你的包。

安装后需要：重启 pi。验证：

```bash
jev --status --check      # 网关 + key 活验证
/jev gateway              # pi 内查看当前网关
```

## Installing on a new device (full stack)

To reproduce the complete Jev environment (the `jev` CLI + `jev` tool + web/information tools + the agent-facing routing doc) on another machine:

```bash
curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/bootstrap/install-jev-stack.sh | bash
```

Or from a clone: `bash bootstrap/install-jev-stack.sh`.

The script is **idempotent** (safe to re-run; it will not append duplicate config) and performs seven steps:

1. Preflight `python3` / `pi` / `git`
2. `pi install git:github.com/gmaxxxie/jev-cli` (skipped if present)
3. Install the web/information tools: `npm:pi-web-access` (`fetch_content` / `web_search`), `npm install -g agent-browser`, and `git clone` + `uv sync` of `jev-ultrafast`
4. Locate the repo and symlink `~/.local/bin/jev` (reuses `install.sh`; falls back to `git clone` into `~/.local/share/jev-cli` for the network install)
5. Write `~/.pi/agent/jev-gateway.json` → `official`
6. Add the "Jev decision tools" section to `~/.pi/agent/AGENTS.md`
7. Prompt for the API key (no echo, never in shell history), then live-verify it with one free `GET /v1/models`

Flags: `--update` (refresh what is already installed), `--no-key` (skip key entry, `export TYPESAFE_API_KEY` later), `--no-agents`, `--dry-run`. (`--no-bashrc` is deprecated: the rc env block was retired together with the pi-typesafe extension.)

**Only the API key and `jev-ultrafast/.env` need manual handling.** Everything else comes from the public internet (GitHub + npm) — no need to copy files off the old machine. The script exits non-zero on failure (including a failing `--check` live verification), so it is safe to use in CI / automation.

### Updating a device that already has an older version

Two layers, and they are independent:

```bash
pi update --extensions                      # pi packages (both npm + git sources)
curl -fsSL .../bootstrap/install-jev-stack.sh | bash -s -- --update   # bootstrap-managed bits
```

`pi update --extensions` alone refreshes the packages but **not** the things the bootstrap owns, so
it is not enough to move an old device to the current version. Re-running the bootstrap picks up
what the old version never installed (the web/information tool set). Note `pi update` with no flags
updates **pi itself only** — extensions need `--extensions`.

`--update` makes the bootstrap refresh what is already present; without it the script only installs
what is missing, so a re-run never silently upgrades your packages.

Afterwards: restart pi. Verify with:

```bash
jev --status --check      # gateway + live key check
/jev gateway              # show current gateway inside pi
```

## Repository layout

```
jev-cli/
├── bin/                jev CLI script (single-file Python)
├── extension/          pi extensions
│   └── jev.ts          structured decision tool
├── bootstrap/
│   └── install-jev-stack.sh   full-stack installer for a new device
├── install.sh          one-shot installer (INSTALL_CLI switch; CLI + API key guide)
├── package.json        pi package manifest (git source)
└── README.md           (English)
```

## License

MIT
