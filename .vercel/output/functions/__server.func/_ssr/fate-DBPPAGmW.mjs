import { i as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { S as require_jsx_runtime, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as KIND_META } from "./kinds-CVVa7OP-.mjs";
import { r as Route$3 } from "./router-IV7pLPzu.mjs";
import { n as NightShell } from "./router-IV7pLPzu2.mjs";
import { t as Button } from "./button-DYzYpPVv.mjs";
import { t as Badge } from "./badge-Bi0zyN2V.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/fate-DBPPAGmW.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function pick(missions, avoid) {
	const pool = avoid ? missions.filter((m) => m.id !== avoid) : missions;
	const list = pool.length ? pool : missions;
	return list[Math.floor(Math.random() * list.length)];
}
function FatePage() {
	const { missions } = Route$3.useLoaderData();
	const [spinning, setSpinning] = (0, import_react.useState)(true);
	const [mission, setMission] = (0, import_react.useState)(null);
	const reduced = usePrefersReducedMotion();
	const strip = (0, import_react.useMemo)(() => {
		if (missions.length === 0) return [];
		const times = Math.max(8, Math.ceil(24 / missions.length));
		return Array.from({ length: times }, () => missions).flat();
	}, [missions]);
	(0, import_react.useEffect)(() => {
		if (missions.length === 0) return;
		if (reduced) {
			setMission(pick(missions));
			setSpinning(false);
			return;
		}
		const chosen = pick(missions);
		const id = window.setTimeout(() => {
			setMission(chosen);
			setSpinning(false);
		}, 2200);
		return () => window.clearTimeout(id);
	}, [missions, reduced]);
	function reroll() {
		const next = pick(missions, mission?.id);
		if (reduced) {
			setMission(next);
			return;
		}
		setSpinning(true);
		window.setTimeout(() => {
			setMission(next);
			setSpinning(false);
		}, 1800);
	}
	if (missions.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NightShell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "text-muted",
		children: "Ночь пустая. Зайди в список позже."
	}) });
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(NightShell, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "font-mono text-xs uppercase tracking-caps text-accent",
			children: "Как повезёт"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "mt-2 font-display text-5xl italic leading-none sm:text-6xl",
			children: "Ночь решает"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-4 max-w-lg text-sm leading-relaxed text-muted",
			children: "Один слот. Без выбора, без оправданий. То, что выпало — на эту ночь."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "relative mt-10 overflow-hidden rounded-xl bg-surface shadow-border",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-surface to-transparent" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-surface to-transparent" }),
				spinning ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "relative h-72 overflow-hidden",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "fate-window",
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "spin-strip py-8",
						children: strip.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "px-6 py-3 font-display text-2xl italic text-fg/80 sm:text-3xl",
							children: item.title
						}, `${item.id}-${i}`))
					})]
				}) : mission ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "stagger-in border-l-2 border-accent px-6 py-10 sm:px-10",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs uppercase tracking-caps text-accent",
							children: KIND_META[mission.kind].track
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
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "mt-3 max-w-3xl font-display text-3xl italic leading-tight sm:text-4xl",
							children: mission.title
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-4 max-w-2xl text-sm leading-relaxed text-muted",
							children: mission.excerpt
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-4 flex flex-wrap gap-1.5",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: KIND_META[mission.kind].label }), mission.labels.slice(0, 3).map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: l }, l))]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-8 flex flex-col gap-3 sm:flex-row",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								asChild: true,
								size: "lg",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
									to: "/m/$owner/$repo/$number",
									params: {
										owner: mission.owner,
										repo: mission.repo,
										number: String(mission.number)
									},
									children: "Взять эту ночь"
								})
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "button",
								variant: "ghost",
								size: "lg",
								onClick: reroll,
								children: "Ещё раз"
							})]
						})
					]
				}) : null
			]
		})
	] });
}
function usePrefersReducedMotion() {
	const [reduced, setReduced] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(mq.matches);
		const onChange = () => setReduced(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return reduced;
}
//#endregion
export { FatePage as component };
