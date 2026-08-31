import { i as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { S as require_jsx_runtime, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as relativeTime, n as KIND_META, t as KINDS } from "./kinds-CVVa7OP-.mjs";
import { n as Route$2 } from "./router-IV7pLPzu.mjs";
import { a as cn, n as NightShell } from "./router-IV7pLPzu2.mjs";
import { t as Badge } from "./badge-Bi0zyN2V.mjs";
import { t as UrlIntake } from "./url-intake-CpXTGUa9.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/list-CkvtztYR.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function MissionCard({ mission, className }) {
	const meta = KIND_META[mission.kind];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
		to: "/m/$owner/$repo/$number",
		params: {
			owner: mission.owner,
			repo: mission.repo,
			number: String(mission.number)
		},
		className: cn("group block rounded-lg bg-surface p-4 shadow-border transition-[box-shadow,transform] duration-150 ease-out hover:shadow-border-hover active:scale-[0.99]", className),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-mono text-xs uppercase tracking-caps text-accent",
					children: meta.track
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-xs tabular-nums text-faint",
					children: relativeTime(mission.updatedAt)
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 font-mono text-xs text-muted",
				children: [
					mission.owner,
					"/",
					mission.repo,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "text-faint",
						children: [
							" ",
							mission.isPr ? "PR" : "#",
							mission.number
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mt-2 font-display text-xl leading-snug text-fg group-hover:text-paper",
				children: mission.title
			}),
			mission.excerpt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 line-clamp-3 text-sm leading-relaxed text-muted",
				children: mission.excerpt
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-4 flex flex-wrap gap-1.5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: meta.label }), mission.labels.slice(0, 2).map((label) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: label }, label))]
			})
		]
	});
}
function ListPage() {
	const { missions, live } = Route$2.useLoaderData();
	const [kind, setKind] = (0, import_react.useState)("all");
	const [q, setQ] = (0, import_react.useState)("");
	const filtered = (0, import_react.useMemo)(() => {
		const query = q.trim().toLowerCase();
		return missions.filter((m) => {
			if (kind !== "all" && m.kind !== kind) return false;
			if (!query) return true;
			return m.title.toLowerCase().includes(query) || m.repo.toLowerCase().includes(query) || m.owner.toLowerCase().includes(query);
		});
	}, [
		missions,
		kind,
		q
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(NightShell, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "stagger-in",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-mono text-xs uppercase tracking-caps text-accent",
					children: "The list"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-2 font-display text-5xl italic leading-none sm:text-6xl",
					children: "Список ночи"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-4 max-w-xl text-sm leading-relaxed text-muted",
					children: "Реальные открытые ишьюсы и PR из стека, на котором крутится этот сайт: Vite, TanStack, Tailwind, React, Zod. Не учебные задачи — живой опенсорс."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-2 font-mono text-xs text-faint",
					children: [
						live ? "Эфир GitHub открыт." : "Эфир молчит. Последняя известная ночь.",
						" ",
						filtered.length,
						" ",
						filtered.length === 1 ? "миссия" : "миссий"
					]
				})
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-8 max-w-xl",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UrlIntake, {})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "no-scrollbar mt-8 flex gap-2 overflow-x-auto pb-1",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FilterChip, {
				active: kind === "all",
				onClick: () => setKind("all"),
				label: "Все"
			}), KINDS.map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FilterChip, {
				active: kind === k,
				onClick: () => setKind(k),
				label: KIND_META[k].track
			}, k))]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
			className: "sr-only",
			htmlFor: "mission-search",
			children: "Поиск"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			id: "mission-search",
			value: q,
			onChange: (e) => setQ(e.target.value),
			placeholder: "Репозиторий или заголовок",
			suppressHydrationWarning: true,
			className: "mt-4 h-12 w-full max-w-md rounded-md bg-surface px-4 text-sm text-fg placeholder:text-faint shadow-border focus:outline-none focus:ring-2 focus:ring-accent/70"
		}),
		filtered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-12 text-sm text-muted",
			children: "В этой полосе ночь пустая."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-8 grid gap-4 sm:grid-cols-2",
			children: filtered.map((mission) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MissionCard, { mission }, mission.id))
		})
	] });
}
function FilterChip({ active, onClick, label }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		onClick,
		className: cn("h-11 shrink-0 rounded-full px-4 text-xs tracking-wide transition-colors duration-150", active ? "bg-paper text-bg" : "text-muted shadow-border hover:text-fg"),
		children: label
	});
}
//#endregion
export { ListPage as component };
