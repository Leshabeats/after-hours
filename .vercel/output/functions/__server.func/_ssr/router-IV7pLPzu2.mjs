import { i as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { S as require_jsx_runtime, f as useRouterState, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as clsx } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { n as create, t as persist } from "../_libs/zustand.mjs";
import { a as router_exports } from "./router-IV7pLPzu.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/utils-C_uf36nf.js
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
//#endregion
//#region node_modules/.nitro/vite/services/ssr/assets/night-shell-COzwkV6F.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var useNightLog = create()(persist((set, get) => ({
	entries: [],
	take: (mission) => {
		if (get().entries.find((e) => e.id === mission.id)) return;
		set({ entries: [{
			id: mission.id,
			owner: mission.owner,
			repo: mission.repo,
			number: mission.number,
			title: mission.title,
			kind: mission.kind,
			url: mission.url,
			isPr: mission.isPr,
			status: "taken",
			takenAt: Date.now()
		}, ...get().entries] });
	},
	setStatus: (id, status) => set({ entries: get().entries.map((e) => e.id === id ? {
		...e,
		status
	} : e) }),
	drop: (id) => set({ entries: get().entries.filter((e) => e.id !== id) })
}), { name: "after-hours-log" }));
function useHydrated() {
	const [hydrated, setHydrated] = (0, import_react.useState)(() => {
		if (typeof window === "undefined") return false;
		return useNightLog.persist.hasHydrated();
	});
	(0, import_react.useEffect)(() => {
		if (useNightLog.persist.hasHydrated()) {
			setHydrated(true);
			return;
		}
		return useNightLog.persist.onFinishHydration(() => setHydrated(true));
	}, []);
	return hydrated;
}
var NAV = [
	{
		to: "/fate",
		label: "Как повезёт",
		short: "Удача"
	},
	{
		to: "/list",
		label: "Список",
		short: "Список"
	},
	{
		to: "/log",
		label: "Журнал",
		short: "Журнал"
	}
];
function NightShell({ children }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const count = useNightLog((s) => s.entries.length);
	const shown = useHydrated() ? count : 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative min-h-dvh bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grain",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", {
				className: "sticky top-0 z-30 border-b border-border/80 bg-bg/80 backdrop-blur-md",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "chrome-safe mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: "shrink-0 font-display text-2xl italic tracking-tight text-fg",
						children: "After Hours"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
						className: "ml-auto flex items-center gap-0.5 sm:gap-1",
						children: NAV.map((item) => {
							const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
								to: item.to,
								className: cn("relative flex h-11 items-center px-2 text-xs tracking-wide sm:px-3 sm:text-sm", active ? "text-fg" : "text-muted hover:text-fg"),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "sm:hidden",
										children: item.short
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "hidden sm:inline",
										children: item.label
									}),
									item.to === "/log" && shown > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "ml-1.5 font-mono text-xs tabular-nums text-accent",
										children: shown
									}) : null
								]
							}, item.to);
						})
					})]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
				className: "mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6",
				children
			})
		]
	});
}
//#endregion
export { cn as a, useNightLog as i, NightShell as n, useHydrated as r, router_exports as t };
