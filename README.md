# jev-cli

TypeSafe Jev System One 决策模型命令行工具（走 [OpenRouter Decisions API](https://openrouter.ai/docs/features/decisions)），附 pi 扩展。

## 是什么

给一段程序/业务状态描述，Jev 模型快速给出结构化决策，而不是长篇生成：

| 类型 | 含义 | 返回 |
|------|------|------|
| `noul` | 二值判断 | P(true) ∈ [0,1] |
| `choice` | 从选项里选一个 | 选中项 key |
| `score` | 有序评分（2-10 级） | 等级序号 |

典型用途：路由、分类、紧急度判定、工作流里的门禁决策。

## 依赖

- Python 3（仅标准库，`argparse`/`json`/`urllib`，无第三方包）
- OpenRouter API key（用于 Decisions API 端点）
- （可选）[pi](https://github.com/earendil-works/pi-coding-agent) — 需要 pi 扩展时才装

## 安装

三样东西：CLI 脚本、pi 扩展、API key。

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

# 2. pi 扩展（可选）
mkdir -p ~/.pi/agent/extensions
cp extension/jev.ts ~/.pi/agent/extensions/
# pi 里 /reload 生效

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

# score：有序评分（2-10 级，从低到高）
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

## 目录结构

```
jev-cli/
├── bin/          jev CLI 脚本（单文件 Python）
├── extension/    pi 扩展（注册 jev 工具）
├── install.sh    一键安装脚本
└── README.md
```

## License

MIT
