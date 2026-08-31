import { S as require_jsx_runtime, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as KIND_META } from "./kinds-CVVa7OP-.mjs";
import { i as useNightLog, n as NightShell, r as useHydrated } from "./router-IV7pLPzu2.mjs";
import { t as Button } from "./button-DYzYpPVv.mjs";
import { t as Badge } from "./badge-Bi0zyN2V.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/log-D_dweigm.js
var import_jsx_runtime = require_jsx_runtime();
var STATUSES = [
	{
		id: "taken",
		label: "Взято"
	},
	{
		id: "shipping",
		label: "В работе"
	},
	{
		id: "shipped",
		label: "Закрыто"
	}
];
function LogPage() {
	const entries = useNightLog((s) => s.entries);
	const setStatus = useNightLog((s) => s.setStatus);
	const drop = useNightLog((s) => s.drop);
	const hydrated = useHydrated();
	const shown = hydrated ? entries : [];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(NightShell, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "font-mono text-xs uppercase tracking-caps text-accent",
			children: "Night log"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "mt-2 font-display text-5xl italic leading-none sm:text-6xl",
			children: "Журнал"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-4 max-w-lg text-sm leading-relaxed text-muted",
			children: "То, что ты взял этой и прошлыми ночами. Только на этом устройстве."
		}),
		!hydrated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-16 font-mono text-xs uppercase tracking-caps text-muted",
			children: "Загрузка эфира"
		}) : shown.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-16 max-w-md",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-display text-3xl italic",
					children: "Пока тихо."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-muted",
					children: "Возьми ночь из списка или позволь ей выбрать самой."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6 flex flex-col gap-3 sm:flex-row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						asChild: true,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/fate",
							children: "Как повезёт"
						})
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						asChild: true,
						variant: "ghost",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/list",
							children: "Список"
						})
					})]
				})
			]
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-10 space-y-4",
			children: shown.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
				className: "rounded-lg bg-surface p-5 shadow-border",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-start justify-between gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-w-0",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-mono text-xs uppercase tracking-caps text-accent",
								children: KIND_META[entry.kind].track
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/m/$owner/$repo/$number",
								params: {
									owner: entry.owner,
									repo: entry.repo,
									number: String(entry.number)
								},
								className: "mt-2 block font-display text-2xl italic leading-snug hover:text-paper",
								children: entry.title
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-2 font-mono text-xs text-muted",
								children: [
									entry.owner,
									"/",
									entry.repo,
									" #",
									entry.number
								]
							})
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: STATUSES.find((s) => s.id === entry.status)?.label })]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4 flex flex-wrap gap-2",
					children: [STATUSES.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "button",
						size: "sm",
						variant: entry.status === s.id ? "paper" : "ghost",
						onClick: () => setStatus(entry.id, s.id),
						children: s.label
					}, s.id)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "button",
						size: "sm",
						variant: "quiet",
						onClick: () => drop(entry.id),
						children: "Убрать"
					})]
				})]
			}, entry.id))
		})
	] });
}
//#endregion
export { LogPage as component };
