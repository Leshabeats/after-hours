export const KINDS = [
  "blinding",
  "alone",
  "eyes",
  "tears",
  "heartless",
  "late",
  "faith",
  "bleed",
] as const;

export type Kind = (typeof KINDS)[number];

export type Mission = {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  excerpt: string;
  body: string;
  url: string;
  kind: Kind;
  labels: string[];
  comments: number;
  updatedAt: string;
  createdAt: string;
  isPr: boolean;
  author: string;
  live: boolean;
};

export const KIND_META: Record<
  Kind,
  { track: string; label: string; duty: string }
> = {
  blinding: {
    track: "Blinding Lights",
    label: "Баг на виду",
    duty: "Ломает тех, кто этим пользуется каждый день",
  },
  alone: {
    track: "Alone Again",
    label: "Первый шаг",
    duty: "Можно закрыть в одну ночь, одному",
  },
  eyes: {
    track: "In Your Eyes",
    label: "Ревью",
    duty: "Чужой PR. Прочитать, проверить, не пропустить дыру",
  },
  tears: {
    track: "Save Your Tears",
    label: "Доки / DX",
    duty: "Ошибка в тексте, в котором люди тонут",
  },
  heartless: {
    track: "Heartless",
    label: "Надёжность",
    duty: "Тесты, CI, то, без чего релиз врёт",
  },
  late: {
    track: "Too Late",
    label: "Перф",
    duty: "Утечки, тормоза, таймеры, которые не отпускают",
  },
  faith: {
    track: "Faith",
    label: "Корректность",
    duty: "Типы, контракты, тихие ложные 500 вместо 404",
  },
  bleed: {
    track: "Until I Bleed Out",
    label: "Старый долг",
    duty: "Ишью, которое открыто слишком давно",
  },
};

export function missionId(owner: string, repo: string, number: number) {
  return `${owner}/${repo}#${number}`;
}

export function missionPath(owner: string, repo: string, number: number) {
  return `/m/${owner}/${repo}/${number}`;
}

export function parseGithubRef(raw: string): {
  owner: string;
  repo: string;
  number: number;
} | null {
  const trimmed = raw.trim();
  const url =
    /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pull)\/(\d+)/i.exec(
      trimmed,
    );
  if (url) {
    return { owner: url[1], repo: url[2], number: Number(url[3]) };
  }
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(trimmed);
  if (short) {
    return { owner: short[1], repo: short[2], number: Number(short[3]) };
  }
  return null;
}

const MONTH_MS = 1000 * 60 * 60 * 24 * 30;

export function classifyKind(input: {
  title: string;
  labels: string[];
  isPr: boolean;
  createdAt: string;
}): Kind {
  if (input.isPr) return "eyes";
  const labels = input.labels.map((l) => l.toLowerCase());
  const title = input.title.toLowerCase();
  const age = Date.now() - Date.parse(input.createdAt);

  if (labels.some((l) => /good first|beginner|easy|first-timers/.test(l))) {
    return "alone";
  }
  if (labels.some((l) => /doc/.test(l)) || /\bdocs?\b|readme|typo/.test(title)) {
    return "tears";
  }
  if (labels.some((l) => /secur|vulnerab|cve/.test(l))) return "faith";
  if (
    labels.some((l) => /perf|memory/.test(l)) ||
    /leak|oom|memory|slow|perf/.test(title)
  ) {
    return "late";
  }
  if (labels.some((l) => /test|ci|flaky/.test(l)) || /flaky|test/.test(title)) {
    return "heartless";
  }
  if (age > MONTH_MS * 8) return "bleed";
  if (
    labels.some((l) => /bug|crash/.test(l)) ||
    /crash|hang|500|broken|fail/.test(title)
  ) {
    return "blinding";
  }
  return "blinding";
}

export function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&#39;/g, "'");
}

export function excerptOf(body: string, max = 220) {
  const clean = decodeEntities(body)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

export function formatRepo(owner: string, repo: string) {
  return `${owner}/${repo}`;
}

export function relativeTime(iso: string) {
  const delta = Date.now() - Date.parse(iso);
  const min = Math.round(delta / 60000);
  if (min < 60) return `${Math.max(1, min)} мин`;
  const hrs = Math.round(min / 60);
  if (hrs < 48) return `${hrs} ч`;
  const days = Math.round(hrs / 24);
  if (days < 45) return `${days} дн`;
  const months = Math.round(days / 30);
  return `${months} мес`;
}
