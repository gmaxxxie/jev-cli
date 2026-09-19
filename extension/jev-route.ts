/**
 * Jev Route 扩展 — 工具路由决策
 *
 * 给定一个网页/信息类任务描述，判断该用本机哪一套手段去完成。
 *
 * 设计动机：`jev` 工具只能回答调用方塞进 state 的问题；调用方（主模型）
 * 每次措辞不同，路由结果就不稳定。本工具把**本机工具清单与决策原则内置**，
 * 调用方只给任务描述，路由依据由扩展统一注入 —— 无人值守/子 agent 场景
 * 下没有主模型把关，这一步必须可复现。
 *
 * 双层设计（关键）：
 *   - **规则层**：有序确定性规则，永不失败。作为兜底，且与 Jev 互为交叉校验。
 *   - **Jev 层**：独立判断（不喂规则结论，避免自我印证），给出评分与备选。
 *   两层**故意相互独立**：一致 = 高置信；分歧 = 明确暴露出来，而不是悄悄合并。
 *
 * 与 `jev_triage` 对齐的降级策略：
 *   - Jev 失败绝不阻断，回退规则层
 *   - Jev 输出经白名单校验，清单外的工具名一律丢弃
 *   - 只做辅助判断，不执行任何工具，不碰确定性红线
 *
 * 用法（pi 里对 LLM 暴露的 tool）：
 *   jev_route(task="帮我把 200 个新闻网站首页的头条抓下来汇总成表格")
 *   jev_route(task="登录我们内部系统导出上个月报表", unattended=true)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const JEV_CLI = process.env.HOME + "/.local/bin/jev";

/** 本机可用的控网页/取信息手段。清单在此写死：调用方不参与，保证可复现。 */
type ToolId = "fetch_content" | "web_search" | "agent-browser" | "jev-ultrafast";

interface ToolSpec {
	id: ToolId;
	capability: string;
	cost: string;
}

const TOOLS: ToolSpec[] = [
	{
		id: "fetch_content",
		capability:
			"读取网页内容/提取/总结，不做任何交互。支持 urls 数组并行，适合批量抓取。免费，约 1s。",
		cost: "免费",
	},
	{
		id: "web_search",
		capability: "联网搜索信息并综合答案，不访问指定 URL。免费，约 2s。",
		cost: "免费",
	},
	{
		id: "agent-browser",
		capability:
			"命令式：由调用方决定点哪个元素。免费、毫秒级。但元素引用页面一变就失效且会静默点错。适合自有系统、页面稳定、元素位置已知。",
		cost: "免费（毫秒级）",
	},
	{
		id: "jev-ultrafast",
		capability:
			"声明式：给目标，模型自己看页面找路，页面改版能自适应。适合第三方站点、结构未知、需要判断、要真实登录态交互。",
		cost: "约 $0.0005/步，0.7-0.9s/步",
	},
];

/**
 * 风险/成本序，无人值守时用于在两层分歧中取更保守的一方。
 * 依据：fetch_content 只读免费 < web_search 只读免费 < agent-browser 可写但会静默点错
 * < jev-ultrafast 可写、花钱、能执行不可逆交互。
 */
const RISK: Record<ToolId, number> = {
	fetch_content: 0,
	web_search: 1,
	"agent-browser": 2,
	"jev-ultrafast": 3,
};

// ── 可用性检测 ──
// 清单仍写死（保证可复现），但每台设备实际装了什么不一样。不检测的话，
// 路由会把任务推给一个不存在的工具，主模型拿到推荐后调用失败。
// 检测只做标注与候选剔除，不改路由原则。

/** 取 pi 的包安装记录，判断某个 pi 包是否已装（扩展只能靠这个判断工具是否注册）。 */
function piPackages(): string {
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
	try {
		if (!existsSync(settingsPath)) return "";
		const s = JSON.parse(readFileSync(settingsPath, "utf-8")) as { packages?: unknown };
		return Array.isArray(s.packages) ? s.packages.join("\n") : "";
	} catch {
		return "";
	}
}

/** 可执行文件是否在 PATH 里（用 shell 的 `command -v` 语义，兼容非 POSIX 路径）。 */
function onPath(bin: string): boolean {
	try {
		const out = execFileSync(process.platform === "win32" ? "where" : "which", [bin], {
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 3000,
		});
		return out.toString().trim().length > 0;
	} catch {
		return false;
	}
}

interface Availability {
	available: boolean;
	/** 不可用时的原因/安装提示 */
	hint?: string;
}

/**
 * 检测清单里每个工具是否真的可用。检测项与 `bootstrap/install-jev-stack.sh` 的
 * 安装步骤一一对应，装了就能被认出来。
 */
function detectAvailability(): Record<ToolId, Availability> {
	const pkgs = piPackages();
	const hasWebAccess = pkgs.includes("pi-web-access");
	const hasBrowser = onPath("agent-browser");
	const ufDir = process.env.JEV_ULTRAFAST_DIR ?? join(homedir(), "Project", "jev-ultrafast");
	const hasUltrafast = existsSync(join(ufDir, "pyproject.toml"));

	return {
		fetch_content: hasWebAccess
			? { available: true }
			: { available: false, hint: "pi install npm:pi-web-access" },
		web_search: hasWebAccess
			? { available: true }
			: { available: false, hint: "pi install npm:pi-web-access" },
		"agent-browser": hasBrowser
			? { available: true }
			: { available: false, hint: "npm install -g agent-browser" },
		"jev-ultrafast": hasUltrafast
			? { available: true }
			: {
					available: false,
					hint: "git clone https://github.com/browser-use/jev-ultrafast ~/Project/jev-ultrafast && uv sync",
				},
	};
}

// ── 信号识别（模块级，避免每次重建正则） ──
const RE_INTERACT =
	/点击|点一下|点它|按下|填表|填写|填入|提交|登录|登陆|下单|购买|买一|帮我买|订票|订一张|帮我订|输入|勾选|选择|申请|导出|下载/;
const RE_BULK = /批量|全部|所有|每个|逐个|\d{2,}\s*个|多少个|N ?个|一批/;
const RE_OWN =
	/内部|自有|我们自己的|我们团队|自己团队|自家|管理系统|监控面板|布局固定|位置.*知道|元素.*知道|三年没改|很久没改|不会改/;
const RE_THIRDPARTY = /第三方|别人|外部|陌生|没见过|不确定|会改版|偶尔调整|改版|竞品|大厂|变动/;
const RE_VOLATILE = /改版|变动|调整|不稳定/;
const RE_SEARCH = /搜索|搜一下|查一下|查查|最新消息|有什么新闻/;
const RE_READONLY =
	/抓取|爬取|抓下来|提取|总结|汇总|读取|看看|写了什么|内容|README|标题|头条|文章|文档|列表/;

interface RuleResult {
	picked: ToolId;
	rule: string;
	signals: Record<string, boolean>;
}

/**
 * 有序确定性规则：按优先级依次判定，第一个命中的即结果。
 * 顺序本身编码了决策原则（越靠前越优先），比加权打分可解释、无平局。
 */
function ruleRoute(task: string): RuleResult {
	const signals = {
		interact: RE_INTERACT.test(task),
		bulk: RE_BULK.test(task),
		own: RE_OWN.test(task),
		thirdparty: RE_THIRDPARTY.test(task),
		volatile: RE_VOLATILE.test(task),
		search: RE_SEARCH.test(task),
		readonly: RE_READONLY.test(task),
	};
	const pick = (picked: ToolId, rule: string): RuleResult => ({ picked, rule, signals });

	// R1 批量且无需交互 → 并行抓取，避免开多个浏览器会话
	if (signals.bulk && !signals.interact)
		return pick("fetch_content", "R1 批量且无需交互 → 并行抓取，比开 N 个浏览器会话省几个数量级");

	// R2 自有系统且布局稳定 → 元素已知，手动指挥免费且毫秒级
	if (signals.own && !signals.thirdparty)
		return pick("agent-browser", "R2 自有系统且布局稳定 → 元素位置已知，手动指挥免费且毫秒级");

	// R3 第三方/易变页面 → 元素引用会失效，交由模型看页面自己找路
	if (signals.thirdparty && (signals.interact || signals.volatile))
		return pick("jev-ultrafast", "R3 第三方或易变页面 → 元素引用会静默失效，需模型自适应找路");

	// R4 搜索意图且无指定页面 → 直接联网搜索
	if (signals.search && !signals.readonly)
		return pick("web_search", "R4 搜索意图且无指定页面 → 直接联网搜索，不必访问具体 URL");

	// R5 无需交互 → 只读抓取即可，不上浏览器
	if (!signals.interact)
		return pick("fetch_content", "R5 无需交互 → 只读抓取即可，先探路再决定是否上浏览器");

	// R6 兜底：需要交互且无更省手段 → 保守选模型自主决策
	return pick("jev-ultrafast", "R6 需要交互且无更省手段 → 模型自主决策（兜底保守选择）");
}

async function callJev(
	state: string,
	questions: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const { stdout } = await execFileP(JEV_CLI, [state, "-q", JSON.stringify(questions), "-j"], {
		timeout: 90_000,
		maxBuffer: 1024 * 1024,
	});
	const parsed = JSON.parse(stdout);
	return (parsed.answers ?? {}) as Record<string, unknown>;
}

export default function jevRouteExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "jev_route",
		label: "Jev Route",
		description:
			"Route a web/information task to the right local capability. Use when unsure which of " +
			"fetch_content / web_search / agent-browser / jev-ultrafast fits, or in unattended / " +
			"sub-agent runs where no human reviews the choice. The tool holds the local tool " +
			"inventory itself, so you only pass a task description and routing stays reproducible " +
			"instead of depending on your phrasing. Returns a recommended tool, a runner-up, " +
			"per-tool fit scores, the fired rule, and whether the deterministic rule layer and the " +
			"Jev model agreed. It never executes anything.",
		parameters: Type.Object({
			task: Type.String({
				description:
					"What the user wants done, in their own words. Include any detail about page stability, " +
					"whether interaction is needed, and how many pages are involved.",
			}),
			unattended: Type.Optional(
				Type.Boolean({
					description:
						"Set true when no human will review the choice (sub-agent, cron, pipeline). " +
						"On disagreement between the rule layer and Jev, the lower-risk option is recommended.",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const { task, unattended } = params as { task: string; unattended?: boolean };

			// ── 0. 可用性检测（清单写死，但设备实际装了什么不一定） ──
			const avail = detectAvailability();
			const usable = TOOLS.filter((t) => avail[t.id].available);
			const missing = TOOLS.filter((t) => !avail[t.id].available);
			// 全部缺失时不能剔完候选，否则无从路由：退回全清单并在输出里警示。
			const candidates = usable.length > 0 ? usable : TOOLS;

			// ── 1. 规则层（永不失败，兜底 + 交叉校验） ──
			const rule = ruleRoute(task);

			// ── 2. Jev 层（独立判断：不喂规则结论，避免自我印证） ──
			// 只把“已安装”的工具当候选，否则会把任务推给不存在的工具。
			const state =
				`任务描述: ${task}\n\n` +
				`本机可用的控网页/取信息手段（只能从中选，不得发明其它手段）:\n` +
				candidates.map((t, i) => `${i + 1}. ${t.id} — ${t.capability}`).join("\n") +
				(missing.length
					? `\n\n【本机未安装，不得选为答案】\n` +
						missing.map((t) => `- ${t.id}（装法: ${avail[t.id].hint}）`).join("\n")
					: "") +
				`\n\n决策原则:\n` +
				`- 只需读取内容、尤其批量（>5 个页面）=> fetch_content\n` +
				`- 只需联网搜索、无指定 URL => web_search\n` +
				`- 需要交互，且元素位置已知、页面稳定（自有系统）=> agent-browser\n` +
				`- 需要交互，但页面结构未知/第三方站点会改版/需要判断 => jev-ultrafast\n` +
				`- 不确定时先 fetch_content 探路，再决定是否上浏览器\n` +
				(unattended
					? `- 【无人值守】无人复核，优先选失败代价最低的手段：只读优先、避免不可逆交互。\n`
					: "");

			const questions: Record<string, unknown> = {
				tool: {
					type: "choice",
					instructions: "完成这个任务最合适的手段是哪一个？只能选清单内的",
					criteria: Object.fromEntries(candidates.map((t) => [t.id, t.capability.slice(0, 90)])),
				},
			};
			for (const t of candidates) {
				questions[`fit_${t.id.replace(/[-.]/g, "_")}`] = {
					type: "score",
					instructions: `${t.id} 对完成这个任务的适配程度`,
					criteria: ["极不合适", "不太合适", "一般", "合适", "极合适"],
				};
			}

			let jevAnswers: Record<string, unknown> | null = null;
			let jevError: string | null = null;
			try {
				jevAnswers = await callJev(state, questions);
			} catch (e) {
				jevError = e instanceof Error ? e.message : String(e);
			}

			// ── 3. 白名单校验（清单外的工具名一律丢弃） ──
			// Jev 的 choice 返回结构为 { type, choice, probabilities, confidence }，
			// 不是裸字符串 —— 必须解包 .choice，否则永远拿不到结果。
			const ids = candidates.map((t) => t.id) as string[];
			let jevPick: ToolId | null = null;
			let jevOutOfList: string | null = null;
			let jevConf: number | null = null;
			let jevProbs: Record<string, number> | null = null;
			if (jevAnswers) {
				const raw = jevAnswers.tool;
				const obj = (typeof raw === "string" ? { choice: raw } : raw) as
					{ choice?: unknown; confidence?: unknown; probabilities?: unknown } | undefined;
				const c = obj?.choice;
				if (typeof c === "string") {
					if (ids.includes(c)) jevPick = c as ToolId;
					else jevOutOfList = c;
				}
				if (typeof obj?.confidence === "number") jevConf = obj.confidence;
				if (obj?.probabilities && typeof obj.probabilities === "object")
					jevProbs = obj.probabilities as Record<string, number>;
			}

			// ── 4. 决策：一致则采信；分歧时按模式取策 ──
			const agree = jevPick !== null && jevPick === rule.picked;
			let finalPick: ToolId;
			let policy: string;
			if (jevPick === null) {
				finalPick = rule.picked;
				policy = jevError
					? "Jev 不可用 → 采信规则层（确定性兜底）"
					: "Jev 未给出清单内结果 → 采信规则层";
			} else if (agree) {
				finalPick = jevPick;
				policy = "规则层与 Jev 一致 → 高置信采信";
			} else if (unattended) {
				// 无人值守：分歧时取风险更低的一方（blast radius 最小）
				finalPick = RISK[jevPick] <= RISK[rule.picked] ? jevPick : rule.picked;
				policy = `无人值守分歧 → 取风险更低的一方（${finalPick}）`;
			} else {
				finalPick = jevPick;
				policy = "存在分歧 → 采信 Jev（规则层结论一并列出供复核）";
			}

			// ── 5. 输出 ──
			const spec = TOOLS.find((t) => t.id === finalPick)!;
			const L: string[] = [];
			L.push("## Jev Route — 工具路由");
			L.push("");
			L.push(`**任务**: ${task}`);
			if (unattended) L.push("**模式**: 无人值守（分歧时取低风险方案）");
			L.push("");
			L.push(`### 推荐: \`${finalPick}\`  （${spec.cost}）`);
			L.push(spec.capability);
			if (!avail[finalPick].available) {
				L.push("");
				L.push(
					`### ⚠️ 推荐的工具本机未安装\n` +
						`\`${finalPick}\` 在本机不可用，直接用会失败。装法:\n` +
						"```bash\n" +
						avail[finalPick].hint +
						"\n```",
				);
			}
			L.push("");
			L.push(`**决策依据**: ${policy}`);
			L.push("");

			// 清单写死，设备实际装的不一样：把差异明确报出来，而不是默默当成可用。
			if (missing.length) {
				L.push("### 本机未安装（已从候选中剔除）");
				for (const t of missing) L.push(`- \`${t.id}\` — 装法: ${avail[t.id].hint}`);
				if (usable.length === 0) {
					L.push("");
					L.push("⚠️ **全部手段都未安装**，本次路由退回完整清单仅供参考。");
				}
				L.push("");
			}

			const fired = Object.entries(rule.signals)
				.filter(([, v]) => v)
				.map(([k]) => k);
			L.push("### 规则层");
			L.push(`- 命中规则: ${rule.rule}`);
			L.push(`- 识别信号: ${fired.length ? fired.join("、") : "（无）"}`);
			L.push("");

			if (jevAnswers) {
				const scored = candidates
					.map((t) => {
						const raw = jevAnswers![`fit_${t.id.replace(/[-.]/g, "_")}`] as
							{ score?: unknown } | number | undefined;
						// score 同样返回 { score, confidence }，需解包；兼容裸数字以防端点变化。
						const num =
							typeof raw === "number" ? raw : typeof raw?.score === "number" ? raw.score : null;
						const v = num === null ? null : Math.min(4, Math.max(0, num));
						return { id: t.id, score: v === null ? null : Math.round((v / 4) * 100) };
					})
					.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
				L.push("### Jev 层");
				L.push(
					`- Jev 选择: \`${jevPick ?? "（未给出清单内结果）"}\`` +
						(jevConf !== null ? `（把握度 ${(jevConf * 100).toFixed(0)}%）` : ""),
				);
				if (jevProbs) {
					const top = Object.entries(jevProbs)
						.filter(([k]) => ids.includes(k))
						.sort((a, b) => b[1] - a[1])
						.map(([k, p]) => `${k} ${(p * 100).toFixed(0)}%`)
						.join("  |  ");
					if (top) L.push(`- 概率分布: ${top}`);
				}
				L.push(`- 一致性: ${agree ? "✅ 与规则层一致" : "⚠️ 与规则层分歧"}`);
				L.push("- 适配度评分（0-100）:");
				for (const s of scored) {
					const mark = s.id === finalPick ? " ← 推荐" : "";
					L.push(`  - ${s.id}: ${s.score === null ? "n/a" : s.score}${mark}`);
				}
				const runner = scored.find((s) => s.id !== finalPick && s.score !== null);
				if (runner) L.push(`- 备选: \`${runner.id}\`（${runner.score}）`);
				if (jevOutOfList) L.push(`- ⚠️ Jev 返回清单外工具名 \`${jevOutOfList}\`，已丢弃`);
			} else {
				L.push("### ⚠️ Jev 层不可用，已回退规则层");
				L.push(`- 原因: ${jevError}`);
			}

			L.push("");
			L.push("### 注意");
			L.push(
				"本工具只给建议、不执行任何操作。若你比本工具更了解上下文（页面是否 JS 渲染、用户历史偏好），" +
					"可以覆盖推荐结果 —— 请说明理由。",
			);

			return {
				content: [{ type: "text" as const, text: L.join("\n") }],
				details: {
					recommended: finalPick,
					jev_pick: jevPick,
					rule_pick: rule.picked,
					rule_fired: rule.rule,
					signals: fired,
					agreement: jevPick === null ? null : agree,
					policy,
					jev_confidence: jevConf,
					jev_probabilities: jevProbs,
					jev_error: jevError,
					jev_out_of_list: jevOutOfList,
					unattended: Boolean(unattended),
					available: Object.fromEntries(TOOLS.map((t) => [t.id, avail[t.id].available])),
					missing_tools: missing.map((t) => t.id),
				},
			};
		},
	});
}
