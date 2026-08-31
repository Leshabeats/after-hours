import { i as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { S as require_jsx_runtime, b as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { s as parseGithubRef } from "./kinds-CVVa7OP-.mjs";
import { a as cn } from "./router-IV7pLPzu2.mjs";
import { t as Button } from "./button-DYzYpPVv.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/url-intake-CpXTGUa9.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function UrlIntake({ className, tone = "dark" }) {
	const navigate = useNavigate();
	const [value, setValue] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)("");
	function onSubmit(e) {
		e.preventDefault();
		const parsed = parseGithubRef(value);
		if (!parsed) {
			setError("Нужен URL GitHub issue или PR, либо owner/repo#123");
			return;
		}
		setError("");
		navigate({
			to: "/m/$owner/$repo/$number",
			params: {
				owner: parsed.owner,
				repo: parsed.repo,
				number: String(parsed.number)
			}
		});
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		onSubmit,
		className: cn("w-full", className),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-stretch gap-2",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
					className: "sr-only",
					htmlFor: "issue-url",
					children: "Ссылка на issue"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					id: "issue-url",
					value,
					onChange: (e) => {
						setValue(e.target.value);
						if (error) setError("");
					},
					placeholder: "github.com/owner/repo/issues/…",
					suppressHydrationWarning: true,
					className: cn("h-12 min-h-11 min-w-0 flex-1 rounded-md bg-surface px-4 text-sm text-fg placeholder:text-faint shadow-border focus:outline-none focus:ring-2 focus:ring-accent/70", tone === "on-hero" && "bg-bg/70 backdrop-blur-sm")
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "submit",
					variant: "ghost",
					size: "lg",
					className: "shrink-0",
					children: "Взять"
				})
			]
		}), error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 text-xs text-accent",
			role: "alert",
			children: error
		}) : null]
	});
}
//#endregion
export { UrlIntake as t };
