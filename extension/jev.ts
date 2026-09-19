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

// ---- 默认值（网关预设见下方 GATEWAYS，与 bin/jev 的 GATEWAY_PRESETS 对齐）----
const DEFAULT_TIMEOUT = 90_000; // 工具执行超时（ms）

interface JevConfig {
	gateway?: string; // "official" | "openrouter"；传给 CLI 的 -g，并作为网关配置的单一事实源
	model?: string;
	endpoint?: string;
	timeoutMs?: number;
	defaultQuestion?: string; // -q 默认值（name:instructions 缩写或 JSON）
}

// 网关预设（与 CLI 的 GATEWAY_PRESETS 对齐；CLI 仍是执行侧权威）
const GATEWAYS: Record<string, { label: string; endpoint: string; model: string }> = {
	official: {
		label: "TypeSafe 官方直连",
		endpoint: "https://api.typesafe.ai/v1/systemone",
		model: "jev-latest",
	},
	openrouter: {
		label: "OpenRouter Decisions",
		endpoint: "https://openrouter.ai/api/alpha/decisions",
		model: "typesafe/jev-1.13",
	},
};
const GATEWAY_CONFIG = join(process.env.HOME ?? "", ".pi", "agent", "jev-gateway.json");

/** 读取 CLI 的网关配置（与 CLI 共用同一个文件，避免两套配置脱节）。 */
function loadGatewayFile(): string | undefined {
	try {
		if (existsSync(GATEWAY_CONFIG)) {
			const raw = JSON.parse(readFileSync(GATEWAY_CONFIG, "utf-8"));
			const g = raw?.gateway;
			if (typeof g === "string" && g in GATEWAYS) return g;
		}
	} catch (e) {
		console.error("[jev] 读取网关配置失败:", e);
	}
	return undefined;
}

/** 写入 CLI 的网关配置（与 `jev --use <gw>` 等价）。 */
function saveGatewayFile(gateway: string) {
	let existing: Record<string, unknown> = {};
	try {
		if (existsSync(GATEWAY_CONFIG))
			existing = JSON.parse(readFileSync(GATEWAY_CONFIG, "utf-8")) ?? {};
	} catch {
		/* 文件损坏就重写 */
	}
	existing.gateway = gateway;
	writeFileSync(GATEWAY_CONFIG, JSON.stringify(existing, null, 2) + "\n", "utf-8");
}

/** 有效网关：扩展配置 > CLI 网关文件 > 默认 official。 */
function effectiveGateway(cfg: JevConfig): string {
	if (cfg.gateway && cfg.gateway in GATEWAYS) return cfg.gateway;
	return loadGatewayFile() ?? "official";
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

function hasAuthKey(gateway: string): boolean {
	if (process.env.JEV_API_KEY) return true;
	if (gateway === "official") {
		if (process.env.TYPESAFE_API_KEY) return true;
		try {
			const p = join(process.env.HOME ?? "", ".pi", "agent", "pi-typesafe", "auth.json");
			if (existsSync(p)) {
				const k = JSON.parse(readFileSync(p, "utf-8"))?.apiKey;
				if (typeof k === "string" && k.length > 0) return true;
			}
		} catch {
			/* ignore */
		}
		return false;
	}
	if (process.env.OPENROUTER_API_KEY) return true;
	try {
		if (existsSync(AUTH_PATH)) {
			const auth = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
			const key = auth?.openrouter?.key;
			return typeof key === "string" && key.length > 0;
		}
	} catch {
		/* ignore */
	}
	return false;
}

const TYPESAFE_AUTH_PATH = join(process.env.HOME ?? "", ".pi", "agent", "pi-typesafe", "auth.json");

/** 写入官方 TypeSafe key（pi-typesafe 的 auth.json，与 /typesafe login 同一处）。 */
function writeTypesafeKey(key: string) {
	let auth: Record<string, unknown> = {};
	try {
		if (existsSync(TYPESAFE_AUTH_PATH))
			auth = JSON.parse(readFileSync(TYPESAFE_AUTH_PATH, "utf-8")) ?? {};
	} catch (e) {
		console.error("[jev] 读取 pi-typesafe/auth.json 失败:", e);
	}
	auth.apiKey = key;
	writeFileSync(TYPESAFE_AUTH_PATH, JSON.stringify(auth, null, 2) + "\n", {
		encoding: "utf-8",
		mode: 0o600,
	});
}

function clearTypesafeKey() {
	try {
		if (existsSync(TYPESAFE_AUTH_PATH)) {
			const auth = JSON.parse(readFileSync(TYPESAFE_AUTH_PATH, "utf-8")) ?? {};
			delete auth.apiKey;
			writeFileSync(TYPESAFE_AUTH_PATH, JSON.stringify(auth, null, 2) + "\n", {
				encoding: "utf-8",
				mode: 0o600,
			});
		}
	} catch (e) {
		console.error("[jev] 清除官方 key 失败:", e);
	}
}

function clearOpenRouterKey() {
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

function formatConfig(cfg: JevConfig): string {
	const gw = effectiveGateway(cfg);
	const preset = GATEWAYS[gw];
	const lines = [
		"Jev CLI 配置:",
		`  gateway      : ${gw} (${preset.label})${cfg.gateway ? "  [jev-config.json]" : ""}`,
		`  端点         : ${cfg.endpoint ?? preset.endpoint}${cfg.endpoint ? "  ← 覆盖网关预设" : ""}`,
		`  模型         : ${cfg.model ?? preset.model}${cfg.model ? "  ← 覆盖网关预设（跨网关模型名不通用）" : ""}`,
		`  timeout(ms)  : ${cfg.timeoutMs ?? DEFAULT_TIMEOUT}`,
		`  defaultQuestion: ${cfg.defaultQuestion ?? "（未设置，默认问 is_urgent）"}`,
		`  API key      : ${hasAuthKey(gw) ? `✓ 已配置（${gw} 对应来源）` : "✗ 未配置"}`,
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
							description: "Instruction or yes/no question. May be empty string.",
						}),
						criteria: Type.Optional(
							Type.Object({
								true: Type.Optional(Type.String()),
								false: Type.Optional(Type.String()),
							}),
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
				},
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { state, questions } = params as {
				state: string;
				questions: Record<string, unknown>;
			};
			const jsonSpec = JSON.stringify(questions);
			const cfg = loadConfig();
			const gateway = effectiveGateway(cfg);
			const args: string[] = [state, "-q", jsonSpec, "-j"];
			args.push("-g", gateway);
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
					const a = ans as {
						type?: string;
						noul?: number;
						choice?: string;
						score?: number;
					};
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
					typeof usage.cost === "number"
						? ` $${usage.cost.toFixed(6)}`
						: typeof usage.input_tokens === "number"
							? ` $${(((usage.input_tokens as number) / 1e6) * 0.042).toFixed(6)}（估算）`
							: "";
				return {
					content: [
						{
							type: "text" as const,
							text:
								lines.join("\n") +
								`\n网关: ${gateway}  模型: ${result.model}` +
								(cost ? `\nusage: ${cost}` : ""),
						},
					],
					details: {
						gateway,
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
		description: "查看 Jev 配置/用法；`/jev config` 交互式配置（模型、端点、默认问题、API key）",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			const cfg = loadConfig();

			// 非 config 子命令：显示状态 + 用法
			if (trimmed !== "config") {
				// /jev gateway [name] — 与 `jev --use` 写同一个文件
				if (trimmed === "gateway" || trimmed.startsWith("gateway ")) {
					const target = trimmed.slice("gateway".length).trim().toLowerCase();
					if (!target) {
						const cur = effectiveGateway(cfg);
						ctx.ui.notify(
							`当前网关: ${cur} (${GATEWAYS[cur].label})\n` +
								`可用: ${Object.keys(GATEWAYS).join(" | ")}\n` +
								`切换: /jev gateway openrouter\n\n${formatConfig(cfg)}`,
							"info",
						);
						return;
					}
					if (!(target in GATEWAYS)) {
						ctx.ui.notify(
							`未知网关 ${target}；可选: ${Object.keys(GATEWAYS).join(" | ")}`,
							"warning",
						);
						return;
					}
					saveGatewayFile(target);
					// 让 jev-config.json 不再用另一网关的模型名/端点压过预设
					const cleared: string[] = [];
					if (cfg.gateway) {
						cfg.gateway = target;
						cleared.push("gateway");
					}
					if (cfg.model && cfg.model !== GATEWAYS[target].model) {
						delete cfg.model;
						cleared.push("model");
					}
					if (cfg.endpoint && cfg.endpoint !== GATEWAYS[target].endpoint) {
						delete cfg.endpoint;
						cleared.push("endpoint");
					}
					if (cleared.length) saveConfig(cfg);
					ctx.ui.notify(
						`已切换网关 → ${target} (${GATEWAYS[target].label})\n` +
							`端点: ${GATEWAYS[target].endpoint}\n模型: ${GATEWAYS[target].model}\n` +
							(cleared.length ? `已从 jev-config.json 清除冲突项: ${cleared.join(", ")}\n` : "") +
							`写入 ${GATEWAY_CONFIG}（与 \`jev --use ${target}\` 等价）`,
						"info",
					);
					return;
				}

				const usageLines = [
					"用法:",
					"  /jev           显示当前配置与用法",
					"  /jev config    交互式配置（网关/模型/端点/默认问题/API key）",
					"  /jev gateway [official|openrouter]   查看或切换网关（写 jev-gateway.json）",
					"  /jev show      查看当前配置 JSON",
					"  /jev reset     恢复默认配置",
					"",
					"LLM 侧工具: jev(state, questions) — 结构化决策",
				].join("\n");
				ctx.ui.notify(formatConfig(cfg) + "\n\n" + usageLines, "info");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("非交互模式无法配置，请直接编辑 " + CONFIG_PATH, "warning");
				return;
			}

			// ---- 交互式配置向导 ----
			// 0. 网关
			const curGw = effectiveGateway(cfg);
			const gwChoices = Object.entries(GATEWAYS).map(([k, v]) => `${k}: ${v.label} — ${v.model}`);
			const pickGw = await ctx.ui.select(`选择网关（当前 ${curGw}）`, gwChoices);
			let gateway = cfg.gateway;
			if (pickGw) {
				const g = pickGw.split(":")[0].trim();
				if (g in GATEWAYS) {
					gateway = g;
					saveGatewayFile(g);
				}
			}
			const gwModel = GATEWAYS[gateway ?? curGw].model;

			let model = cfg.model ?? "";
			let endpoint = cfg.endpoint ?? "";
			let timeoutSec = cfg.timeoutMs ? Math.round(cfg.timeoutMs / 1000) : 0;
			let defaultQuestion = cfg.defaultQuestion ?? "";

			// 1. 模型
			const modelChoices = [
				{ value: gwModel, label: gwModel, description: `网关预设（推荐）` },
				{ value: "custom", label: "自定义…", description: "手动输入模型 ID" },
			];
			const pickModel = await ctx.ui.select(
				`选择 Jev 模型（默认 ${gwModel}）`,
				modelChoices.map((c) => `${c.value}: ${c.label} — ${c.description}`),
			);
			if (pickModel) {
				if (pickModel.startsWith("custom")) {
					const m = await ctx.ui.input("模型 ID:", model || gwModel);
					if (m) model = m.trim();
				} else {
					model = pickModel.split(":")[0].trim();
					if (model === gwModel) model = ""; // 等于预设就不落盘，避免以后切网关时冲突
				}
			}

			// 2. 端点
			const epPreset = GATEWAYS[gateway ?? curGw].endpoint;
			const epChoices = [
				{ value: "default", label: "跟随网关预设", description: epPreset },
				{ value: "custom", label: "自定义…", description: "手动输入端点 URL" },
			];
			const pickEp = await ctx.ui.select(
				"选择 Decisions API 端点",
				epChoices.map((c) => `${c.value}: ${c.label} — ${c.description}`),
			);
			if (pickEp) {
				if (pickEp.startsWith("custom")) {
					const e = await ctx.ui.input("端点 URL:", endpoint || epPreset);
					if (e) endpoint = e.trim();
				} else {
					endpoint = "";
				}
			}

			// 3. 超时（秒）
			const tInput = await ctx.ui.input(
				"超时秒数（回车保留默认）:",
				timeoutSec ? String(timeoutSec) : "90",
			);
			const tParsed = tInput ? parseInt(tInput.trim(), 10) : NaN;
			if (!Number.isNaN(tParsed) && tParsed > 0) timeoutSec = tParsed;

			// 4. 默认问题（-q）
			const dqInput = await ctx.ui.input(
				"默认问题（-q，name:instructions 或 JSON，回车清空/保持）:",
				defaultQuestion,
			);
			defaultQuestion = dqInput?.trim() ?? defaultQuestion;

			// 5. API key
			let key = "";
			const keyChoices = [
				{ value: "skip", label: "保持不变", description: "不修改现有 key" },
				{
					value: "input",
					label: "输入新 key",
					description: "写入 ~/.pi/agent/auth.json",
				},
				{
					value: "clear",
					label: "清除 key",
					description: "从 auth.json 删除 openrouter.key",
				},
			];
			const pickKey = await ctx.ui.select(
				`API key 如何处理?（当前网关 ${gateway ?? curGw}）`,
				keyChoices.map((c) => `${c.value}: ${c.label} — ${c.description}`),
			);
			if (pickKey) {
				if (pickKey.startsWith("input")) {
					const k = await ctx.ui.input("API key:", "");
					if (k && k.trim()) {
						key = k.trim();
						if ((gateway ?? curGw) === "official") writeTypesafeKey(key);
						else writeAuthKey(key);
					}
				} else if (pickKey.startsWith("clear")) {
					if ((gateway ?? curGw) === "official") clearTypesafeKey();
					else clearOpenRouterKey();
				}
			}

			const newCfg: JevConfig = {};
			if (gateway && gateway !== (loadGatewayFile() ?? "official")) newCfg.gateway = gateway;
			if (model && model !== gwModel) newCfg.model = model;
			if (endpoint && endpoint !== epPreset) newCfg.endpoint = endpoint;
			if (timeoutSec && timeoutSec !== 90) newCfg.timeoutMs = timeoutSec * 1000;
			if (defaultQuestion) newCfg.defaultQuestion = defaultQuestion;
			saveConfig(newCfg);

			ctx.ui.notify(
				"Jev 配置已保存 → " +
					CONFIG_PATH +
					"\n" +
					formatConfig(newCfg) +
					(key ? "\nAPI key 已写入 auth.json" : ""),
				"info",
			);
		},
	});
}
