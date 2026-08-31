import { n as createServerFn, t as TSS_SERVER_FUNCTION } from "./ssr.mjs";
import { a as string, i as object, r as number, t as boolean } from "../_libs/zod.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/api-roh_8uRD.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var getMissions_createServerFn_handler = createServerRpc({
	id: "312cc4c76b93808e167b28b44c7e85f7c4831e4fd407b06f434215ad06429a26",
	name: "getMissions",
	filename: "src/lib/api.ts"
}, (opts) => getMissions.__executeServer(opts));
var getMissions = createServerFn({ method: "GET" }).handler(getMissions_createServerFn_handler, async () => {
	const { loadMissions } = await import("./github-live-e81NKSn1.mjs");
	return loadMissions();
});
var getMission_createServerFn_handler = createServerRpc({
	id: "c267e25339dc1bbda6b57677f2426dd0cca0360094cff5a113a520044c3dc622",
	name: "getMission",
	filename: "src/lib/api.ts"
}, (opts) => getMission.__executeServer(opts));
var getMission = createServerFn({ method: "POST" }).validator(object({
	owner: string().min(1).max(80),
	repo: string().min(1).max(80),
	number: number().int().positive()
})).handler(getMission_createServerFn_handler, async ({ data }) => {
	const { loadMission } = await import("./github-live-e81NKSn1.mjs");
	return loadMission(data.owner, data.repo, data.number);
});
var briefMission_createServerFn_handler = createServerRpc({
	id: "72cd0d7e350396b571665d424a8ada7e320b6c7e710888c950abe7ef0df2059f",
	name: "briefMission",
	filename: "src/lib/api.ts"
}, (opts) => briefMission.__executeServer(opts));
var briefMission = createServerFn({ method: "POST" }).validator(object({
	owner: string().min(1).max(80),
	repo: string().min(1).max(80),
	number: number().int().positive(),
	title: string().max(300),
	body: string().max(8e3),
	url: string().max(400),
	isPr: boolean()
})).handler(briefMission_createServerFn_handler, async ({ data }) => {
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "Разбор ночи сейчас недоступен."
	};
	const prompt = `Ты старший инженер, который помогает закрывать реальный open source ${data.isPr ? "открытый pull request" : "открытый issue"}.
Ответь СТРОГО валидным JSON без markdown-ограждений со схемой:
{
  "summary": "2-4 предложения по-русски: в чём суть и почему это не шум",
  "difficulty": "solo" | "night" | "bleed",
  "whyItMatters": "одно предложение: кому от этого станет лучше",
  "likelyFiles": ["пути файлов, которые скорее всего затронуты"],
  "firstSteps": ["3-5 конкретных шагов, без воды"],
  "howToTest": "как проверить фикс",
  "agentPrompt": "готовый промпт НА АНГЛИЙСКОМ для coding-агента: repo, issue url, expected change, test plan, constraints (smallest correct change, follow contributing, no drive-by refactors)",
  "risks": "что можно сломать, если торопиться"
}
difficulty: solo = одна ночь одному, night = нужна голова, bleed = глубокий/старый.

Репозиторий: ${data.owner}/${data.repo}
${data.isPr ? "PR" : "Issue"} #${data.number}
URL: ${data.url}
Заголовок: ${data.title}

Тело:
${data.body.slice(0, 6e3) || "(пусто)"}`;
	const res = await fetch("https://api.x.ai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model: "grok-4.5",
			temperature: .3,
			max_tokens: 1400,
			response_format: { type: "json_object" },
			messages: [{
				role: "system",
				content: "You help people spend AI tokens on real open-source work. Be precise. No fluff. JSON only."
			}, {
				role: "user",
				content: prompt
			}]
		})
	});
	if (!res.ok) return {
		ok: false,
		error: `xAI ответил ${res.status}`
	};
	const text = (await res.json()).choices?.[0]?.message?.content ?? "";
	try {
		const parsed = JSON.parse(text);
		if (!parsed.summary || !parsed.agentPrompt) return {
			ok: false,
			error: "Разбор пришёл пустым."
		};
		return {
			ok: true,
			brief: {
				summary: String(parsed.summary),
				difficulty: parsed.difficulty === "solo" || parsed.difficulty === "bleed" ? parsed.difficulty : "night",
				whyItMatters: String(parsed.whyItMatters ?? ""),
				likelyFiles: Array.isArray(parsed.likelyFiles) ? parsed.likelyFiles.map(String).slice(0, 8) : [],
				firstSteps: Array.isArray(parsed.firstSteps) ? parsed.firstSteps.map(String).slice(0, 6) : [],
				howToTest: String(parsed.howToTest ?? ""),
				agentPrompt: String(parsed.agentPrompt),
				risks: String(parsed.risks ?? "")
			}
		};
	} catch {
		return {
			ok: false,
			error: "Не разобрал ответ модели."
		};
	}
});
//#endregion
export { briefMission_createServerFn_handler, getMission_createServerFn_handler, getMissions_createServerFn_handler };
