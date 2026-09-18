# jev-cli

TypeSafe Jev System One 决策模型命令行工具（走 [OpenRouter Decisions API](https://openrouter.ai/docs/features/decisions)），附两个 pi 扩展：`jev`（结构化决策）+ `jev_triage`（多候选决策支持）。

## 是什么

给一段程序/业务状态描述，Jev 模型快速给出结构化决策，而不是长篇生成：

| 类型 | 含义 | 返回 |
|------|------|------|
| `noul` | 二值判断 | P(true) ∈ [0,1] |
| `choice` | 从选项里选一个 | 选中项 key + 各选项概率 |
| `score` | 有序评分（criteria 数档位） | 0..(N-1) 浮点 + confidence |

典型用途：路由、分类、紧急度判定、工作流里的门禁决策。

## 依赖

- Python 3（仅标准库，`argparse`/`json`/`urllib`，无第三方包）
- OpenRouter API key（用于 Decisions API 端点）
- （可选）[pi](https://github.com/earendil-works/pi-coding-agent) — 需要 pi 扩展时才装

## 安装

三样东西：CLI 脚本、pi 扩展（`jev` + `jev_triage`）、API key。

### 一键安装

> 仓库当前为私有，raw 直链需要认证，请用 `git clone`（已配置 GitHub SSH 凭据时免密）：

```bash
git clone git@github.com:gmaxxxie/jev-cli.git /tmp/jev-cli
bash /tmp/jev-cli/install.sh
```

若仓库日后改为公开，也可以：

```bash
curl -fsSL https://raw.githubusercontent.com/gmaxxxie/jev-cli/main/install.sh | bash
```

### 手动安装

```bash
# 1. CLI 脚本
mkdir -p ~/.local/bin
cp bin/jev ~/.local/bin/jev && chmod +x ~/.local/bin/jev

# 2. pi 扩展（可选，默认都装）
mkdir -p ~/.pi/agent/extensions
cp extension/jev.ts ~/.pi/agent/extensions/
cp extension/jev-triage.ts ~/.pi/agent/extensions/
# pi 里 /reload 生效
# 若只要某一个：INSTALL_EXT=1 INSTALL_TRIAGE=0 bash install.sh

# 3. API key（三选一，按优先级）
#    a. 环境变量
export OPENROUTER_API_KEY=sk-or-xxx
#    b. ~/.pi/agent/auth.json
#    {"openrouter": {"key": "sk-or-xxx"}}
#    c. 每次用 --key 传
```

## 用法

```bash
# 最简单：二值判断（默认 noul）
jev "数据库主节点 CPU 95%" -q urgent:需要立即处理吗?

# choice：从选项里选（criteria 对象，顺序即模型所见顺序）
jev "请求进入路由层" -q '{"region":{"type":"choice",\
  "instructions":"select region",\
  "criteria":{"us-east":"美东","eu-west":"欧洲","ap-east":"亚太"}}}'

# score：有序评分（criteria 档位，返回 0..N-1 浮点，越高越强）
jev "客户工单语气激烈" -q '{"anger":{"type":"score",\
  "instructions":"anger level",\
  "criteria":["平静","有些不满","明显生气","威胁要取消"]}}'

# 从文件读 state
jev @state.txt -q ok:一切正常吗?

# 完整 JSON 输出（含 usage/成本）
jev "payout 连续失败 3 次" -q '{"urgent":{"type":"noul",\
  "instructions":"This is urgent",\
  "criteria":{"true":"需立即介入","false":"可稍后处理"}}}' -j
```

### 参数

| 参数 | 说明 | 默认 |
|------|------|------|
| `state` | 状态描述；`@` 开头从文件读；缺省从 stdin 读 | — |
| `-q` | 问题，可多次；`name:instructions` 缩写或 JSON 全量 | 默认问 is_urgent |
| `-m` | 模型 ID | `typesafe/jev-1.13` |
| `-e` | 端点 | `https://openrouter.ai/api/alpha/decisions` |
| `--key` | API key 显式传入 | 环境/auth.json |
| `-t` | 超时秒数 | 60 |
| `-j` | 输出原始 JSON | — |

## pi 扩展

### `jev` — 结构化决策工具

给 pi 注册一个 `jev` 工具：输入 `state` + `questions`，返回结构化判定。用于路由、分类、门禁预筛等。

```jsonc
// pi 里对 LLM 暴露的 tool
jev(state: "数据库主节点 CPU 95%",
    questions: { urgent: { type: "noul", instructions: "需要立即处理吗?" } })
```

### `/jev` — 交互式配置命令

注册一个 `/jev` 斜杠命令，在 pi 里交互式配置 CLI 默认值：

- `/jev` — 显示当前配置与用法
- `/jev config` — 交互式向导（模型 / 端点 / 超时 / 默认问题 / API key）
- `/jev show` — 以 JSON 显示当前配置
- `/jev reset` — 恢复默认（删除配置文件）

配置存于 `~/.pi/agent/jev-config.json`（model / endpoint / timeoutMs / defaultQuestion）；API key 写入 `~/.pi/agent/auth.json` 的 `openrouter.key`（与 install.sh 一致）。`jev` 工具执行时会读该配置，把 `-m` / `-e` / `-t` 传给 CLI，所以这里设的默认值对 LLM 触发的调用同样生效。

### `jev_triage` — 多候选决策支持

当 pi 回复「📋 待办（文档已记录）…需要我继续做哪一项吗？」这类多选决策时刻，pi 调用 `jev_triage`：

```jsonc
// pi 里对 LLM 暴露的 tool
jev_triage(context: "Jev 集成 v1.3 已落地，剩余三项收尾待办",
           candidates: ["回放 E1 一致性", "E1 对接 audit_chain", "接线 autowrite CLI"])
```

输出一份决策支持报告：

1. **候选对比（规则化信号）** — 从候选文本提取依赖/成本/现状
2. **Jev 评分排序** — 每候选一个 `score`（0-10 映射 + 把握度）
3. **推荐优先做** — Jev `choice` 选最优
4. **Top-3 优劣势** — 每候选 `noul` 判优势/风险（P 值）

Jev 失败/超时时自动回退规则化对比，不阻断。建议在 `AGENTS.md` 加约定让 pi 在决策时刻主动调用。

## 目录结构

```
jev-cli/
├── bin/                jev CLI 脚本（单文件 Python）
├── extension/          pi 扩展
│   ├── jev.ts          结构化决策工具
│   └── jev-triage.ts   多候选决策支持工具
├── install.sh          一键安装脚本（INSTALL_CLI / INSTALL_EXT / INSTALL_TRIAGE 开关）
└── README.md
```

## License

MIT
