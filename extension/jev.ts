/**
 * Jev Extension — TypeSafe Jev System One 决策模型工具
 *
 * 在 pi 里注册：
 *   1. `jev` 工具（给 LLM）：给一段程序/业务状态，让 Jev 模型快速做
 *      结构化决策（二值判断 / 选项选择 / 等级评分），返回结构化结果。
 *   2. `/jev` 命令（给用户）：查看当前配置与用法；`/jev config` 交互式
 *      配置 CLI 的默认模型、API 端点、默认问题、API key。
 *
 * 配置存储在 ~/.pi/agent/jev-config.json（扩展侧），执行 jev CLI 时覆盖
 * 其默认值；API key 写入 ~/.pi/agent/auth.json 的 openrouter.key
 * （与 install.sh 行为一致，CLI 会按 环境变量 > auth.json 解析）。
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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const execFileP = promisify(execFile);
const JEV_CLI = process.env.HOME + "/.local/bin/jev";
const CONFIG_PATH = join(process.env.HOME ?? "", ".pi", "agent", "jev-config.json");
const AUTH_PATH = join(process.env.HOME ?? "", ".pi", "agent", "auth.json");

// ---- 默认值（与 bin/jev 对齐）----
const DEFAULT_MODEL = "typesafe/jev-1.13";
const DEFAULT_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_TIMEOUT = 90_000; // 工具执行超时（ms）

interface JevConfig {
	model?: string;
	endpoint?: string;
	timeoutMs?: number;
	defaultQuestion?: string; // -q 默认值（name:instructions 缩写或 JSON）
}

function loadConfig(): JevConfig {
	try {
		if (existsSync(CONFIG_PATH)) {
			const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
			if (raw && typeof raw === "object") return raw as JevConfig;
		}
	} catch (e) {
		console.error("[jev] 读取配置失败:", e);
	}
	return {};
}

function saveConfig(cfg: JevConfig) {
	writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function writeAuthKey(key: string) {
	let auth: Record<string, unknown> = {};
	try {
		if (existsSync(AUTH_PATH)) auth = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
	} catch (e) {
		console.error("[jev] 读取 auth.json 失败:", e);
	}
	const or = (auth.openrouter ?? {}) as Record<string, unknown>;
	or.key = key;
	auth.openrouter = or;
	writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2) + "\n", "utf-8");
}

function hasAuthKey(): boolean {
	try {
		if (existsSync(AUTH_PATH)) {
			const auth = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
			const key = auth?.openrouter?.key;
			return typeof key === "string" && key.length > 0;
		}
	} catch {
		/* ignore */
	}
	return !!process.env.OPENROUTER_API_KEY;
}

function formatConfig(cfg: JevConfig): string {
	const lines = [
		"Jev CLI 配置:",
		`  model        : ${cfg.model ?? DEFAULT_MODEL}`,
		`  endpoint     : ${cfg.endpoint ?? DEFAULT_ENDPOINT}`,
		`  timeout(ms)  : ${cfg.timeoutMs ?? DEFAULT_TIMEOUT}`,
		`  defaultQuestion: ${cfg.defaultQuestion ?? "（未设置，默认问 is_urgent）"}`,
		`  API key      : ${hasAuthKey() ? "✓ 已配置 (auth.json 或 OPENROUTER_API_KEY)" : "✗ 未配置"}`,
	];
	return lines.join("\n");
}

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
			const cfg = loadConfig();
			const args: string[] = [state, "-q", jsonSpec, "-j"];
			if (cfg.model) args.push("-m", cfg.model);
			if (cfg.endpoint) args.push("-e", cfg.endpoint);
			if (cfg.timeoutMs) args.push("-t", String(Math.round(cfg.timeoutMs / 1000)));

			try {
				const { stdout, stderr } = await execFileP(JEV_CLI, args, {
					timeout: (cfg.timeoutMs ?? DEFAULT_TIMEOUT) + 10_000,
					maxBuffer: 1024 * 1024,
					signal,
				});
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

	pi.registerCommand("jev", {
		description:
			"查看 Jev 配置/用法；`/jev config` 交互式配置（模型、端点、默认问题、API key）",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			const cfg = loadConfig();

			// 非 config 子命令：显示状态 + 用法
			if (trimmed !== "config") {
				const usage = [
					"用法:",
					"  /jev           显示当前配置与用法",
					"  /jev config    交互式配置（模型/端点/默认问题/API key）",
					"  /jev show      查看当前配置 JSON",
					"  /jev reset     恢复默认配置",
					"",
					"LLM 侧工具: jev(state, questions) — 结构化决策",
				];
				ctx.ui.notify(formatConfig(cfg) + "\n\n" + usage.join("\n"), "info");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("非交互模式无法配置，请直接编辑 " + CONFIG_PATH, "warning");
				return;
			}

			// ---- 交互式配置向导 ----
			let model = cfg.model ?? "";
			let endpoint = cfg.endpoint ?? "";
			let timeoutSec = cfg.timeoutMs ? Math.round(cfg.timeoutMs / 1000) : 0;
			let defaultQuestion = cfg.defaultQuestion ?? "";

			// 1. 模型
			const modelChoices = [
				{ value: "typesafe/jev-1.13", label: "typesafe/jev-1.13", description: "默认模型（推荐）" },
				{ value: "custom", label: "自定义…", description: "手动输入模型 ID" },
			];
			const pickModel = await ctx.ui.select(
				"选择 Jev 模型（默认 typesafe/jev-1.13）",
				modelChoices.map((c) => `${c.value}: ${c.label} — ${c.description}`)
			);
			if (pickModel) {
				if (pickModel.startsWith("custom")) {
					const m = await ctx.ui.input("模型 ID:", model || "typesafe/jev-1.13");
					if (m) model = m.trim();
				} else {
					model = pickModel.split(":")[0].trim();
				}
			}

			// 2. 端点
			const epChoices = [
				{ value: "default", label: "OpenRouter 官方", description: DEFAULT_ENDPOINT },
				{ value: "custom", label: "自定义…", description: "手动输入端点 URL" },
			];
			const pickEp = await ctx.ui.select(
				"选择 Decisions API 端点",
				epChoices.map((c) => `${c.value}: ${c.label} — ${c.description}`)
			);
			if (pickEp) {
				if (pickEp.startsWith("custom")) {
					const e = await ctx.ui.input("端点 URL:", endpoint || DEFAULT_ENDPOINT);
					if (e) endpoint = e.trim();
				} else {
					endpoint = "";
				}
			}

			// 3. 超时（秒）
			const tInput = await ctx.ui.input("超时秒数（回车保留默认）:", timeoutSec ? String(timeoutSec) : "90");
			const tParsed = tInput ? parseInt(tInput.trim(), 10) : NaN;
			if (!Number.isNaN(tParsed) && tParsed > 0) timeoutSec = tParsed;

			// 4. 默认问题（-q）
			const dqInput = await ctx.ui.input(
				"默认问题（-q，name:instructions 或 JSON，回车清空/保持）:",
				defaultQuestion
			);
			defaultQuestion = dqInput?.trim() ?? defaultQuestion;

			// 5. API key
			let key = "";
			const keyChoices = [
				{ value: "skip", label: "保持不变", description: "不修改现有 key" },
				{ value: "input", label: "输入新 key", description: "写入 ~/.pi/agent/auth.json" },
				{ value: "clear", label: "清除 key", description: "从 auth.json 删除 openrouter.key" },
			];
			const pickKey = await ctx.ui.select(
				"OpenRouter API key 如何处理?",
				keyChoices.map((c) => `${c.value}: ${c.label} — ${c.description}`)
			);
			if (pickKey) {
				if (pickKey.startsWith("input")) {
					const k = await ctx.ui.input("OpenRouter API key:", "");
					if (k && k.trim()) {
						key = k.trim();
						writeAuthKey(key);
					}
				} else if (pickKey.startsWith("clear")) {
					try {
						if (existsSync(AUTH_PATH)) {
							const auth = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
							if (auth?.openrouter) delete (auth.openrouter as Record<string, unknown>).key;
							writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2) + "\n", "utf-8");
						}
					} catch (e) {
						console.error("[jev] 清除 key 失败:", e);
					}
				}
			}

			const newCfg: JevConfig = {};
			if (model && model !== DEFAULT_MODEL) newCfg.model = model;
			if (endpoint && endpoint !== DEFAULT_ENDPOINT) newCfg.endpoint = endpoint;
			if (timeoutSec && timeoutSec !== 90) newCfg.timeoutMs = timeoutSec * 1000;
			if (defaultQuestion) newCfg.defaultQuestion = defaultQuestion;
			saveConfig(newCfg);

			ctx.ui.notify(
				"Jev 配置已保存 → " + CONFIG_PATH + "\n" + formatConfig(newCfg) +
				(key ? "\nAPI key 已写入 auth.json" : ""),
				"info"
			);
		},
	});
}
