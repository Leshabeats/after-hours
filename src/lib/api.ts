import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getMissions = createServerFn({ method: "GET" }).handler(
  async () => {
    const { loadMissions } = await import("./github-live");
    return loadMissions();
  },
);

export const getMission = createServerFn({ method: "POST" })
  .validator(
    z.object({
      owner: z.string().min(1).max(80),
      repo: z.string().min(1).max(80),
      number: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const { loadMission } = await import("./github-live");
    return loadMission(data.owner, data.repo, data.number);
  });

export type Brief = {
  summary: string;
  difficulty: "solo" | "night" | "bleed";
  whyItMatters: string;
  likelyFiles: string[];
  firstSteps: string[];
  howToTest: string;
  agentPrompt: string;
  risks: string;
};

export const briefMission = createServerFn({ method: "POST" })
  .validator(
    z.object({
      owner: z.string().min(1).max(80),
      repo: z.string().min(1).max(80),
      number: z.number().int().positive(),
      title: z.string().max(300),
      body: z.string().max(8000),
      url: z.string().max(400),
      isPr: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true; brief: Brief } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Разбор ночи сейчас недоступен." };
    }

    const role = data.isPr ? "открытый pull request" : "открытый issue";
    const prompt = `Ты старший инженер, который помогает закрывать реальный open source ${role}.
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
${data.body.slice(0, 6000) || "(пусто)"}`;

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.3,
        max_tokens: 1400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You help people spend AI tokens on real open-source work. Be precise. No fluff. JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `xAI ответил ${res.status}` };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(text) as Brief;
      if (!parsed.summary || !parsed.agentPrompt) {
        return { ok: false, error: "Разбор пришёл пустым." };
      }
      return {
        ok: true,
        brief: {
          summary: String(parsed.summary),
          difficulty:
            parsed.difficulty === "solo" || parsed.difficulty === "bleed"
              ? parsed.difficulty
              : "night",
          whyItMatters: String(parsed.whyItMatters ?? ""),
          likelyFiles: Array.isArray(parsed.likelyFiles)
            ? parsed.likelyFiles.map(String).slice(0, 8)
            : [],
          firstSteps: Array.isArray(parsed.firstSteps)
            ? parsed.firstSteps.map(String).slice(0, 6)
            : [],
          howToTest: String(parsed.howToTest ?? ""),
          agentPrompt: String(parsed.agentPrompt),
          risks: String(parsed.risks ?? ""),
        },
      };
    } catch {
      return { ok: false, error: "Не разобрал ответ модели." };
    }
  });
