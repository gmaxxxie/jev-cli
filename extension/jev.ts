/**
 * Jev Extension — TypeSafe Jev System One 决策模型工具
 *
 * 在 pi 里注册一个 `jev` 工具：给一段程序/业务状态，让 Jev 模型快速做
 * 结构化决策（二值判断 / 选项选择 / 等级评分），返回结构化结果。
 *
 * 依赖：~/.local/bin/jev CLI（实际走 OpenRouter Decisions API）
 *
 * 用法（pi 里对 LLM 暴露的 tool）：
 *   jev(state="...", questions={"urgent": {"type":"noul", "instructions":"...",
 *              "criteria": {"true":"...", "false":"..."}}, ...})
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const JEV_CLI = process.env.HOME + "/.local/bin/jev";

export default function jevExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "jev",
		label: "Jev Decision",
		description:
			"Run a TypeSafe Jev System One structured decision: given a state description, " +
			"answer one or more questions with a fast typed result instead of prose. " +
			"Question types: noul (yes/no with 0-1 probability), choice (pick one option), " +
			"score (rate on an ordered 2-10 level scale). Use for routing, classification, " +
			"urgency/gating decisions inside a workflow.",
		parameters: Type.Object({
			state: Type.String({
				description:
					"Program/business state to evaluate. Be concrete: describe what is happening, metrics, symptoms.",
			}),
			questions: Type.Record(
				Type.String(),
				Type.Union([
					Type.Object({
						type: Type.Literal("noul"),
						instructions: Type.String({
							description:
								"Instruction or yes/no question. May be empty string.",
						}),
						criteria: Type.Optional(
							Type.Object({
								true: Type.Optional(Type.String()),
								false: Type.Optional(Type.String()),
							})
						),
					}),
					Type.Object({
						type: Type.Literal("choice"),
						instructions: Type.String(),
						criteria: Type.Record(Type.String(), Type.Optional(Type.String())),
					}),
					Type.Object({
						type: Type.Literal("score"),
						instructions: Type.String(),
						criteria: Type.Array(Type.String()),
					}),
				]),
				{
					description:
						"Questions to ask Jev, keyed by name. Each question has type (noul/choice/score), instructions, and criteria.",
				}
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { state, questions } = params as {
				state: string;
				questions: Record<string, unknown>;
			};
			const jsonSpec = JSON.stringify(questions);

			try {
				const { stdout, stderr } = await execFileP(
					JEV_CLI,
					[state, "-q", jsonSpec, "-j"],
					{ timeout: 90_000, maxBuffer: 1024 * 1024 }
				);
				if (stderr) console.error("[jev] stderr:", stderr);
				const result = JSON.parse(stdout);
				const answers = (result.answers ?? {}) as Record<string, unknown>;
				const lines: string[] = [];
				for (const [name, ans] of Object.entries(answers)) {
					const a = ans as { type?: string; noul?: number; choice?: string; score?: number };
					if (a.type === "noul" && typeof a.noul === "number") {
						lines.push(`${name}: noul=${a.noul.toFixed(3)} (P(true))`);
					} else if (a.type === "choice") {
						lines.push(`${name}: choice=${a.choice}`);
					} else if (a.type === "score") {
						lines.push(`${name}: score=${a.score}`);
					} else {
						lines.push(`${name}: ${JSON.stringify(ans)}`);
					}
				}
				const usage = (result.usage ?? {}) as Record<string, unknown>;
				const cost =
					typeof usage.cost === "number" ? ` $${usage.cost.toFixed(6)}` : "";
				return {
					content: [
						{
							type: "text" as const,
							text: lines.join("\n") + (cost ? `\nusage: ${cost}` : ""),
						},
					],
					details: {
						model: result.model,
						answers,
						usage,
					},
				};
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return {
					content: [{ type: "text" as const, text: `Jev call failed: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	});
}
