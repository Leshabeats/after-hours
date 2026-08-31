//#region node_modules/.nitro/vite/services/ssr/assets/kinds-CVVa7OP-.js
var KINDS = [
	"blinding",
	"alone",
	"eyes",
	"tears",
	"heartless",
	"late",
	"faith",
	"bleed"
];
var KIND_META = {
	blinding: {
		track: "Blinding Lights",
		label: "Баг на виду",
		duty: "Ломает тех, кто этим пользуется каждый день"
	},
	alone: {
		track: "Alone Again",
		label: "Первый шаг",
		duty: "Можно закрыть в одну ночь, одному"
	},
	eyes: {
		track: "In Your Eyes",
		label: "Ревью",
		duty: "Чужой PR. Прочитать, проверить, не пропустить дыру"
	},
	tears: {
		track: "Save Your Tears",
		label: "Доки / DX",
		duty: "Ошибка в тексте, в котором люди тонут"
	},
	heartless: {
		track: "Heartless",
		label: "Надёжность",
		duty: "Тесты, CI, то, без чего релиз врёт"
	},
	late: {
		track: "Too Late",
		label: "Перф",
		duty: "Утечки, тормоза, таймеры, которые не отпускают"
	},
	faith: {
		track: "Faith",
		label: "Корректность",
		duty: "Типы, контракты, тихие ложные 500 вместо 404"
	},
	bleed: {
		track: "Until I Bleed Out",
		label: "Старый долг",
		duty: "Ишью, которое открыто слишком давно"
	}
};
function missionId(owner, repo, number) {
	return `${owner}/${repo}#${number}`;
}
function parseGithubRef(raw) {
	const trimmed = raw.trim();
	const url = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pull)\/(\d+)/i.exec(trimmed);
	if (url) return {
		owner: url[1],
		repo: url[2],
		number: Number(url[3])
	};
	const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(trimmed);
	if (short) return {
		owner: short[1],
		repo: short[2],
		number: Number(short[3])
	};
	return null;
}
var MONTH_MS = 2592e6;
function classifyKind(input) {
	if (input.isPr) return "eyes";
	const labels = input.labels.map((l) => l.toLowerCase());
	const title = input.title.toLowerCase();
	const age = Date.now() - Date.parse(input.createdAt);
	if (labels.some((l) => /good first|beginner|easy|first-timers/.test(l))) return "alone";
	if (labels.some((l) => /doc/.test(l)) || /\bdocs?\b|readme|typo/.test(title)) return "tears";
	if (labels.some((l) => /secur|vulnerab|cve/.test(l))) return "faith";
	if (labels.some((l) => /perf|memory/.test(l)) || /leak|oom|memory|slow|perf/.test(title)) return "late";
	if (labels.some((l) => /test|ci|flaky/.test(l)) || /flaky|test/.test(title)) return "heartless";
	if (age > MONTH_MS * 8) return "bleed";
	if (labels.some((l) => /bug|crash/.test(l)) || /crash|hang|500|broken|fail/.test(title)) return "blinding";
	return "blinding";
}
function decodeEntities(value) {
	return value.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "\"").replace(/'/g, "'").replace(/&#39;/g, "'");
}
function excerptOf(body, max = 220) {
	const clean = decodeEntities(body).replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\[([^\]]+)]\([^)]*\)/g, "$1").replace(/[#>*_`~]/g, " ").replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max).trim()}…`;
}
function relativeTime(iso) {
	const delta = Date.now() - Date.parse(iso);
	const min = Math.round(delta / 6e4);
	if (min < 60) return `${Math.max(1, min)} мин`;
	const hrs = Math.round(min / 60);
	if (hrs < 48) return `${hrs} ч`;
	const days = Math.round(hrs / 24);
	if (days < 45) return `${days} дн`;
	return `${Math.round(days / 30)} мес`;
}
//#endregion
export { excerptOf as a, relativeTime as c, decodeEntities as i, KIND_META as n, missionId as o, classifyKind as r, parseGithubRef as s, KINDS as t };
