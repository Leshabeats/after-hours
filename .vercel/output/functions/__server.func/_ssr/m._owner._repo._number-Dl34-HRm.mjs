import { i as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { S as require_jsx_runtime, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as relativeTime, n as KIND_META } from "./kinds-CVVa7OP-.mjs";
import { o as briefMission, t as Route } from "./router-IV7pLPzu.mjs";
import { n as ExternalLink } from "../_libs/lucide-react.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { i as useNightLog, n as NightShell, r as useHydrated } from "./router-IV7pLPzu2.mjs";
import { t as Button } from "./button-DYzYpPVv.mjs";
import { t as Badge } from "./badge-Bi0zyN2V.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/m._owner._repo._number-Dl34-HRm.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function defaultAgentPrompt(mission) {
	const kind = mission.isPr ? "pull request" : "issue";
	return `You are doing useful open-source work. Close or review this ${kind} with the smallest correct change.

Repo: ${mission.owner}/${mission.repo}
${kind} : ${mission.url}
Title: ${mission.title}

Body:
${mission.body.slice(0, 4e3) || "(empty)"}

Rules:
- Follow the repo's contributing guide and existing code style.
- Do not refactor unrelated code.
- Add or update tests if the repo has a test suite that covers this area.
- If this is a review, write a precise review: bugs, missing tests, API risk — not nits.
- Summarize the change in the PR description.`;
}
function MissionPage() {
	const mission = Route.useLoaderData();
	const meta = KIND_META[mission.kind];
	const take = useNightLog((s) => s.take);
	const entries = useNightLog((s) => s.entries);
	const taken = useHydrated() && entries.some((e) => e.id === mission.id);
	const [brief, setBrief] = (0, import_react.useState)(null);
	const [briefing, setBriefing] = (0, import_react.useState)(false);
	const [briefError, setBriefError] = (0, import_react.useState)("");
	async function copyPrompt(text, label) {
		try {
			await navigator.clipboard.writeText(text);
			toast(label);
		} catch {
			toast("Не удалось скопировать");
		}
	}
	async function runBrief() {
		setBriefing(true);
		setBriefError("");
		const result = await briefMission({ data: {
			owner: mission.owner,
			repo: mission.repo,
			number: mission.number,
			title: mission.title,
			body: mission.body.slice(0, 8e3),
			url: mission.url,
			isPr: mission.isPr
		} });
		setBriefing(false);
		if (!result.ok) {
			setBriefError(result.error);
			return;
		}
		setBrief(result.brief);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(NightShell, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: "/list",
			className: "text-xs tracking-wide text-muted hover:text-fg",
			children: "К списку"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-6 font-mono text-xs uppercase tracking-caps text-accent",
			children: meta.track
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "mt-3 font-mono text-xs text-muted",
			children: [
				mission.owner,
				"/",
				mission.repo,
				" ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "text-faint",
					children: [mission.isPr ? "PR" : "#", mission.number]
				}),
				mission.author ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "text-faint",
					children: [" · ", mission.author]
				}) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "text-faint",
					children: [" · ", relativeTime(mission.updatedAt)]
				}),
				mission.comments > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "text-faint",
					children: [
						" · ",
						mission.comments,
						" комм."
					]
				}) : null
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "mt-3 max-w-3xl font-display text-4xl italic leading-tight sm:text-5xl",
			children: mission.title
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-4 max-w-xl text-sm text-muted",
			children: meta.duty
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-5 flex flex-wrap gap-1.5",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: meta.label }), mission.labels.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: l }, l))]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "button",
					size: "lg",
					onClick: () => {
						take(mission);
						toast("Ночь записана в журнал");
					},
					disabled: taken,
					children: taken ? "Уже в журнале" : "Взять эту ночь"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "button",
					variant: "ghost",
					size: "lg",
					onClick: () => copyPrompt(defaultAgentPrompt(mission), "Протокол агента скопирован"),
					children: "Протокол агента"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					asChild: true,
					variant: "ghost",
					size: "lg",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
						href: mission.url,
						target: "_blank",
						rel: "noreferrer",
						children: ["GitHub", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { className: "size-3.5" })]
					})
				})
			]
		}),
		mission.body ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "mt-12",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-mono text-xs uppercase tracking-caps text-muted",
				children: "Тело"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "body-scroll mt-4 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-5 font-sans text-sm leading-relaxed text-fg/90 shadow-border",
				children: mission.body
			})]
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-10 text-sm text-muted",
			children: mission.excerpt
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "mt-12 rounded-xl bg-surface p-6 shadow-border sm:p-8",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-3xl italic",
					children: "Разбор ночи"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 max-w-xl text-sm leading-relaxed text-muted",
					children: "Токены уходят сюда: модель читает ишью и возвращает план, риски и готовый промпт для агента. Один запрос — по кнопке, не сам."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "button",
					className: "mt-6",
					variant: "paper",
					size: "lg",
					disabled: briefing,
					onClick: () => void runBrief(),
					children: briefing ? "Читает…" : brief ? "Перечитать" : "Разобрать"
				}),
				briefing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-4 font-mono text-xs uppercase tracking-caps text-muted",
					children: "Читает тело. Это займёт несколько секунд."
				}) : null,
				briefError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-4 text-sm text-accent",
					role: "alert",
					children: briefError
				}) : null,
				brief ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-8 space-y-6",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BriefBlock, {
							title: "Суть",
							body: brief.summary
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BriefBlock, {
							title: "Зачем",
							body: brief.whyItMatters
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-mono text-xs uppercase tracking-caps text-muted",
							children: "Сложность"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-sm",
							children: brief.difficulty === "solo" ? "Одна ночь, одному" : brief.difficulty === "bleed" ? "Глубокий долг" : "Нужна голова"
						})] }),
						brief.likelyFiles.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-mono text-xs uppercase tracking-caps text-muted",
							children: "Где смотреть"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "mt-2 space-y-1 font-mono text-sm text-fg",
							children: brief.likelyFiles.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: f }, f))
						})] }) : null,
						brief.firstSteps.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-mono text-xs uppercase tracking-caps text-muted",
							children: "Первые шаги"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
							className: "mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed",
							children: brief.firstSteps.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: s }, s))
						})] }) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BriefBlock, {
							title: "Как проверить",
							body: brief.howToTest
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BriefBlock, {
							title: "Риски",
							body: brief.risks
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
								className: "font-mono text-xs uppercase tracking-caps text-muted",
								children: "Промпт агента"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "button",
								variant: "quiet",
								size: "sm",
								onClick: () => copyPrompt(brief.agentPrompt, "Промпт скопирован"),
								children: "Копировать"
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
							className: "body-scroll mt-3 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-4 font-mono text-xs leading-relaxed text-fg/90 shadow-border",
							children: brief.agentPrompt
						})] })
					]
				}) : null
			]
		})
	] });
}
function BriefBlock({ title, body }) {
	if (!body) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
		className: "font-mono text-xs uppercase tracking-caps text-muted",
		children: title
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "mt-2 text-sm leading-relaxed text-fg/90",
		children: body
	})] });
}
//#endregion
export { MissionPage as component };
