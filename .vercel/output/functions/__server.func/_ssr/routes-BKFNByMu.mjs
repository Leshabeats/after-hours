import { i as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { S as require_jsx_runtime, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as KIND_META, t as KINDS } from "./kinds-CVVa7OP-.mjs";
import { a as cn } from "./router-IV7pLPzu2.mjs";
import { t as Button } from "./button-DYzYpPVv.mjs";
import { t as UrlIntake } from "./url-intake-CpXTGUa9.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BKFNByMu.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function pad(n) {
	return n.toString().padStart(2, "0");
}
function Clock({ className }) {
	const [now, setNow] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		setNow(/* @__PURE__ */ new Date());
		const id = window.setInterval(() => setNow(/* @__PURE__ */ new Date()), 1e3);
		return () => window.clearInterval(id);
	}, []);
	if (!now) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: cn("h-4 w-16 sm:w-40", className),
		"aria-hidden": "true"
	});
	const h = now.getHours();
	const after = h >= 22 || h < 6;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: cn("flex items-baseline gap-3 font-mono text-xs tabular-nums tracking-wider", className),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "text-fg",
			children: [
				pad(h),
				":",
				pad(now.getMinutes()),
				":",
				pad(now.getSeconds())
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: cn("hidden sm:inline", after ? "text-accent" : "text-muted"),
			children: after ? "AFTER HOURS" : "STILL LIGHT"
		})]
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative flex min-h-dvh flex-col overflow-x-hidden bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grain",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
				src: "/hero.jpg",
				alt: "",
				fetchPriority: "high",
				className: "hero-shot outline outline-1 -outline-offset-1 outline-fg/10"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "hero-veil",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "chrome-safe relative z-10 flex items-center justify-between px-4 py-4 sm:px-8",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-display text-2xl italic tracking-tight",
					children: "After Hours"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Clock, {})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
				className: "hero-main relative z-10 mx-auto w-full max-w-5xl px-4 pb-8 sm:px-8 sm:pb-14",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "stagger-in max-w-2xl",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs uppercase tracking-caps text-accent",
							children: "Open source, after midnight"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
							className: "mt-3 font-display text-hero italic leading-none tracking-tight text-fg sm:mt-4",
							children: [
								"After",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
								"Hours"
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-4 max-w-lg text-sm leading-relaxed text-fg/90 sm:mt-6 sm:text-lg",
							children: "Жги токены на ишьюсы стека, которым ты пользуешься. Баг Vite, ревью PR, ночь выбирает цель — или ты берёшь список."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								asChild: true,
								variant: "primary",
								size: "lg",
								className: "w-full sm:w-auto",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
									to: "/fate",
									children: "Как повезёт"
								})
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								asChild: true,
								variant: "ghost",
								size: "lg",
								className: "w-full sm:w-auto",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
									to: "/list",
									children: "Список ночи"
								})
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-6 max-w-xl sm:mt-8",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mb-2 text-xs uppercase tracking-caps text-muted",
								children: "Свой issue"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UrlIntake, { tone: "on-hero" })]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "no-scrollbar mt-8 flex gap-6 overflow-x-auto pb-1 sm:mt-12 sm:grid sm:grid-cols-4 sm:gap-x-6 sm:gap-y-3 sm:overflow-visible",
					children: KINDS.map((kind) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "min-w-36 shrink-0 sm:min-w-0",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-display text-lg italic leading-tight text-fg",
							children: KIND_META[kind].track
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-0.5 text-xs text-muted",
							children: KIND_META[kind].label
						})]
					}, kind))
				})]
			})
		]
	});
}
//#endregion
export { Home as component };
