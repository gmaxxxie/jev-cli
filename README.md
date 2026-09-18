# jev-cli

A CLI for the [TypeSafe Jev System One](https://openrouter.ai/docs/features/decisions) decision model (via the [OpenRouter Decisions API](https://openrouter.ai/docs/features/decisions)), plus two pi extensions: `jev` (structured decisions) and `jev_triage` (multi-candidate decision support).

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
- OpenRouter API key (for the Decisions API endpoint)
- (Optional) [pi](https://github.com/earendil-works/pi-coding-agent) — only needed for the pi extensions

## Install

Three things: the CLI script, the pi extensions (`jev` + `jev_triage`), and an API key.

### One-shot install

> The repo is private, so raw URLs require auth — use `git clone` (passwordless if you have GitHub SSH credentials):

```bash
git clone git@github.com:gmaxxxie/jev-cli.git /tmp/jev-cli
bash /tmp/jev-cli/install.sh
```

If the repo is ever made public, this also works:

```bash
curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/install.sh | bash
```

### Install as a pi package (git source)

```bash
pi install git:github.com/gmaxxxie/jev-cli@v1.0.0
# or from Gitea (LAN)
pi install git:git@192.168.1.69:2222/admin/jev-cli.git@v1.0.0
```

The package registers both extensions (`jev`, `jev_triage`).

### Manual install

```bash
# 1. CLI script
mkdir -p ~/.local/bin
cp bin/jev ~/.local/bin/jev && chmod +x ~/.local/bin/jev

# 2. pi extensions (optional, both by default)
mkdir -p ~/.pi/agent/extensions
cp extension/jev.ts ~/.pi/agent/extensions/
cp extension/jev-triage.ts ~/.pi/agent/extensions/
# /reload in pi to activate
# Only one? INSTALL_EXT=1 INSTALL_TRIAGE=0 bash install.sh

# 3. API key (pick one, in priority order)
#    a. Environment variable
export OPENROUTER_API_KEY=sk-or-xxx
#    b. ~/.pi/agent/auth.json
#    {"openrouter": {"key": "sk-or-xxx"}}
#    c. Per-call via --key
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
| `-m` | Model ID | `typesafe/jev-1.13` |
| `-e` | Endpoint | `https://openrouter.ai/api/alpha/decisions` |
| `--key` | Explicit API key | env / auth.json |
| `-t` | Timeout seconds | 60 |
| `-j` | Raw JSON output | — |

## pi extensions

### `jev` — structured decision tool

Registers a `jev` tool for pi: input `state` + `questions`, returns structured judgments. For routing, classification, gate prescreening, etc.

```jsonc
// tool exposed to the LLM inside pi
jev(state: "database primary CPU 95%",
    questions: { urgent: { type: "noul", instructions: "需要立即处理吗?" } })
```

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

## Repository layout

```
jev-cli/
├── bin/                jev CLI script (single-file Python)
├── extension/          pi extensions
│   ├── jev.ts          structured decision tool
│   └── jev-triage.ts   multi-candidate decision support tool
├── install.sh          one-shot installer (INSTALL_CLI / INSTALL_EXT / INSTALL_TRIAGE switches)
├── package.json        pi package manifest (git source)
└── README.md
```

## License

MIT
