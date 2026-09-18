/**
 * Jev Triage 扩展 — 决策支持工具
 *
 * 当 pi 回复「📋 待办（文档已记录）…需要我继续做哪一项吗？」这类多选
 * 决策时刻，调用本工具：用 TypeSafe Jev System One 对候选做多维度评分 +
 * 选最优 + 优劣势判定，并叠加规则化对比（依赖/成本/现状），输出一份
 * 决策支持报告，帮助用户选「接下来做哪一项」。
 *
 * 设计对齐 AutoWriteO `jev-integration-design.md`：
 *   - score 返回 0..(levels-1) 浮点（0=极低 … 4=极高），映射到 0-10 展示
 *   - Jev 失败/超时绝不阻断，回退规则化对比（同 jev_bridge 降级策略）
 *   - 只做辅助判断，不碰确定性红线
 *
 * 用法（pi 里对 LLM 暴露的 tool）：
 *   jev_triage(
 *     context="用历史审计报告离线回放 E1（Jev 分层 vs 全量 pro 一致性）…",
 *     candidates=["回放 E1 一致性", "E1 对接 audit_chain", "接线 autowrite CLI"],
 *   )
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const JEV_CLI = process.env.HOME + "/.local/bin/jev";

/** 归一化：Jev score 返回 0..(levels-1) 浮点（0=极低 … 4=极高），映射到 0-10 展示 */
function normalizeScore(v: number, levels: number): number {
	const clamped = Math.min(levels - 1, Math.max(0, v));
	return Math.round((clamped / (levels - 1)) * 10 * 10) / 10; // 0-10
}

/** 规则化对比：从候选文本提取依赖/成本/现状信号 */
function extractSignal(text: string): {
	deps: string[];
	cost: string | null;
	status: string | null;
} {
	const deps: string[] = [];
	// 依赖信号：提到"依赖/需要/对接/接入/接线"
	const depMatch = text.match(/(?:依赖|需要|对接|接入|接线|联动)[：:]?\s*([^\s,，。;；]+)/g);
	if (depMatch) {
		for (const m of depMatch) {
			const target = m.replace(/^(?:依赖|需要|对接|接入|接线|联动)[：:]?\s*/, "");
			if (target && !deps.includes(target)) deps.push(target);
		}
	}
	// 成本信号：提到"成本/贵/便宜/耗时"
	const costMatch = text.match(/(成本|耗时|贵|便宜|开销)[^，。;；]*/);
	// 现状信号：提到"已/未/当前/现状/独立"
	const statusMatch = text.match(/((?:已|未|当前|现状)[^，。;；]{0,12})/);
	return {
		deps,
		cost: costMatch ? costMatch[0].trim().slice(0, 40) : null,
		status: statusMatch ? statusMatch[0].trim().slice(0, 40) : null,
	};
}

async function callJev(
	state: string,
	questions: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const { stdout } = await execFileP(
		JEV_CLI,
		[state, "-q", JSON.stringify(questions), "-j"],
		{ timeout: 90_000, maxBuffer: 1024 * 1024 }
	);
	const parsed = JSON.parse(stdout);
	return (parsed.answers ?? {}) as Record<string, unknown>;
}

export default function jevTriageExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "jev_triage",
		label: "Jev Triage",
		description:
			"Decision support for 'which of these should I do next' moments. " +
			"Given a context and a list of candidate tasks/options, uses the TypeSafe Jev " +
			"System One model to (1) score-rank each candidate, (2) pick the single best one, " +
			"(3) flag each candidate's strengths/risks, then overlays rule-based signals " +
			"(dependencies, cost, status) extracted from the candidate text. " +
			"Output is a compact decision-support report with scores, rankings, pros/cons, " +
			"and the recommended pick. Use when the user is choosing between multiple " +
			"documented todos/options and wants background info for a better decision.",
		parameters: Type.Object({
			context: Type.String({
				description:
					"Context / background of the decision. Include what's already known, " +
					"constraints, urgency. Be concrete.",
			}),
			candidates: Type.Array(
				Type.String({
					description:
						"One candidate task/option. Include enough detail (dependencies, " +
						"cost, current status) for Jev and the rule extractor to judge.",
				}),
				{
					description:
						"List of candidate tasks/options to triage. Order matters for display.",
				}
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { context, candidates } = params as {
				context: string;
				candidates: string[];
			};

			if (!candidates.length) {
				return {
					content: [{ type: "text", text: "没有候选，无需 triage。" }],
					details: {},
				};
			}

			// ── 1. 规则化对比（永不失败，作为底色 + Jev 降级回退） ──
			const ruleSignals = candidates.map((c) => ({ text: c, ...extractSignal(c) }));

			const ruleReport = ruleSignals
				.map((r, i) => {
					const parts = [`[${i + 1}] ${r.text}`];
					if (r.deps.length) parts.push(`依赖: ${r.deps.join("、")}`);
					if (r.cost) parts.push(`成本: ${r.cost}`);
					if (r.status) parts.push(`现状: ${r.status}`);
					return parts.join("  |  ");
				})
				.join("\n");

			// ── 2. Jev 判定（失败回退规则报告，不阻断） ──
			const state =
				`上下文: ${context}\n` +
				`候选清单:\n` +
				candidates.map((c, i) => `${i + 1}. ${c}`).join("\n");

			// 2a. 每个候选一个 score（criteria 5 档，Jev 返回 0..4 浮点 + confidence）
			const SCORE_CRITERIA = ["极低", "低", "中", "高", "极高"];
			const scoreQuestions: Record<string, unknown> = {};
			candidates.forEach((_, i) => {
				scoreQuestions[`cand_${i + 1}`] = {
					type: "score",
					instructions: `候选 ${i + 1} 现在做这件事的价值/优先级（相对其他候选）`,
					criteria: SCORE_CRITERIA,
				};
			});
			// 2b. 选最优（choice）
			scoreQuestions["best"] = {
				type: "choice",
				instructions: "从候选中选一个最值得现在做的",
				criteria: Object.fromEntries(
					candidates.map((_, i) => [`${i + 1}`, `候选 ${i + 1}`])
				),
			};

			let jevAnswers: Record<string, unknown> | null = null;
			let jevError: string | null = null;
			try {
				jevAnswers = await callJev(state, scoreQuestions);
			} catch (e) {
				jevError = e instanceof Error ? e.message : String(e);
			}

			// ── 3. 汇总输出 ──
			const lines: string[] = [];
			lines.push("## Jev Triage 决策支持");
			lines.push("");
			lines.push("### 候选对比（规则化信号）");
			lines.push(ruleReport);
			lines.push("");

			if (jevAnswers) {
				// 评分排序
				const scores: { idx: number; score: number; raw: number; conf: number }[] = [];
				for (let i = 0; i < candidates.length; i++) {
					const a = (jevAnswers[`cand_${i + 1}`] ?? {}) as { score?: number; confidence?: number };
					if (typeof a.score === "number")
						scores.push({
							idx: i,
							score: normalizeScore(a.score, SCORE_CRITERIA.length),
							raw: a.score,
							conf: typeof a.confidence === "number" ? a.confidence : 0,
						});
				}
				scores.sort((a, b) => b.score - a.score);

				lines.push("### Jev 评分排序（0-10 分，越高越值得）");
				if (scores.length) {
					scores.forEach((s, rank) => {
						lines.push(`${rank + 1}. 候选 ${s.idx + 1}: ${s.score} 分` +
							(s.conf >= 0.4 ? `（把握度 ${(s.conf * 100).toFixed(0)}%）` : `（把握度低 ${(s.conf * 100).toFixed(0)}%）`));
					});
				} else {
					lines.push("（Jev 未返回有效评分）");
				}
				lines.push("");

				// 最优选择
				const best = (jevAnswers["best"] ?? {}) as { choice?: string };
				if (best.choice) {
					const idx = Number(best.choice) - 1;
					if (idx >= 0 && idx < candidates.length) {
						lines.push(`### 推荐优先做`);
						lines.push(`> **候选 ${idx + 1}**：${candidates[idx]}`);
						lines.push("");
					}
				}

				// 优劣势：对 top-3 候选各问两个 noul（阈值 0.45，兼顾把握度显示）
				const topN = scores.slice(0, 3);
				if (topN.length) {
					const proQ: Record<string, unknown> = {};
					const conQ: Record<string, unknown> = {};
					topN.forEach((s, rank) => {
						const key = `t${rank + 1}`;
						proQ[`${key}_pro`] = {
							type: "noul",
							instructions: `候选 ${s.idx + 1} 有明显优势（低成本/高收益/可解锁后续）`,
							criteria: { true: "有明显优势", false: "优势不明显" },
						};
						conQ[`${key}_con`] = {
							type: "noul",
							instructions: `候选 ${s.idx + 1} 有明显风险（成本高/依赖未就绪/收益不确定）`,
							criteria: { true: "有明显风险", false: "无明显风险" },
						};
					});
					try {
						const proA = await callJev(state, proQ);
						const conA = await callJev(state, conQ);
						lines.push("### Top-3 优劣势（P 值：>0.5 倾向肯定，越高越明显）");
						topN.forEach((s, rank) => {
							const key = `t${rank + 1}`;
							const p = (proA[key + "_pro"] ?? {}) as { noul?: number };
							const c = (conA[key + "_con"] ?? {}) as { noul?: number };
							const proV = typeof p.noul === "number" ? p.noul : 0.5;
							const conV = typeof c.noul === "number" ? c.noul : 0.5;
							const pro = proV >= 0.45;
							const con = conV >= 0.45;
							const tags: string[] = [];
							tags.push(`评分 ${s.score}`);
							tags.push(`优势 ${(proV * 100).toFixed(0)}%`);
							tags.push(`风险 ${(conV * 100).toFixed(0)}%`);
							if (pro) tags.push("✅ 优势信号");
							if (con) tags.push("⚠️ 风险信号");
							lines.push(`- 候选 ${s.idx + 1}（${tags.join(" · ")}）`);
						});
						lines.push("");
					} catch (e) {
						// 优劣势补充判定失败不阻断，忽略
					}
				}
			} else {
				lines.push("### ⚠️ Jev 调用失败，已回退规则化对比");
				lines.push(`原因: ${jevError}`);
				lines.push("建议按依赖/成本信号人工判断，或稍后重试。");
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					jev_failed: !jevAnswers,
					jev_error: jevError,
					rule_signals: ruleSignals,
					answers: jevAnswers,
				},
			};
		},
	});
}
