import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

/** Methods this probe may send. A model turn is intentionally absent. */
export const PROBE_METHODS = new Set([
  "initialize",
  "initialized",
  "thread/list",
  "account/rateLimits/read",
]);

/** Kinds outside the server's default interactive allowlist. Custom kinds such as atlas cannot be named in this enum. */
export const EXTRA_SOURCE_KINDS = ["exec", "appServer", "unknown"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertProbeMethod(method) {
  if (!PROBE_METHODS.has(method)) {
    throw new Error(`probe refuses ${method}`);
  }
}

function sourceLabel(source) {
  if (typeof source === "string") return source;
  if (source && typeof source === "object") {
    if (typeof source.custom === "string") return `custom:${source.custom}`;
    if (source.subAgent) return "subAgent";
  }
  return "missing";
}

function statusLabel(status) {
  if (!status || typeof status !== "object") return "missing";
  const type = typeof status.type === "string" ? status.type : "unknown";
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags.filter(Boolean) : [];
  return flags.length > 0 ? `${type}:${flags.join("+")}` : type;
}

function emptyCounts() {
  return Object.create(null);
}

function bump(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function originLabel(origin) {
  if (origin == null) return "null";
  const text = String(origin);
  const redacted = redactDiagnostic(text).replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "[redacted]",
  );
  return redacted === text ? text : "[redacted]";
}

/** Counts only. Thread titles, previews, paths, and ids are not copied. */
export function summarizeThreads(threads) {
  const sources = emptyCounts();
  const originators = emptyCounts();
  const statuses = emptyCounts();
  let uuidIds = 0;
  for (const thread of threads) {
    bump(sources, sourceLabel(thread?.source));
    bump(originators, originLabel(thread?.originator));
    bump(statuses, statusLabel(thread?.status));
    if (typeof thread?.id === "string" && UUID.test(thread.id)) uuidIds += 1;
  }
  return {
    count: threads.length,
    uuidIds,
    sources,
    originators,
    statuses,
  };
}

function windowOf(window) {
  if (window == null) return null;
  return {
    usedPercent: typeof window.usedPercent === "number" ? window.usedPercent : null,
    windowDurationMins: window.windowDurationMins ?? null,
    resetsAtPresent: window.resetsAt != null,
  };
}

function spendControlOf(snapshot) {
  const reached = snapshot?.spendControlReached;
  const remaining = snapshot?.individualLimit?.remainingPercent;
  return {
    spendControlReached: typeof reached === "boolean" ? reached : null,
    individualRemainingPercent: typeof remaining === "number" ? remaining : null,
  };
}

function creditsOf(snapshot) {
  const credits = snapshot?.credits;
  if (!credits || typeof credits !== "object" || Array.isArray(credits)) return null;
  return {
    hasCredits: typeof credits.hasCredits === "boolean" ? credits.hasCredits : null,
    unlimited: typeof credits.unlimited === "boolean" ? credits.unlimited : null,
  };
}

function summarizeBucket(key, snapshot) {
  const limits = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    limitId: limits.limitId ?? key,
    primary: windowOf(limits.primary),
    secondary: windowOf(limits.secondary),
    rateLimitReachedType: limits.rateLimitReachedType ?? null,
    ...spendControlOf(limits),
    credits: creditsOf(limits),
  };
}

/**
 * Rate-limit shape for the operator running the probe.
 * The account id itself is not copied; only whether the field was present.
 * `buckets` lists every entry of `rateLimitsByLimitId`, not only `rateLimits`.
 */
export function summarizeRateLimits(result) {
  const limits = result?.rateLimits ?? {};
  const byId = result?.rateLimitsByLimitId;
  const buckets =
    byId && typeof byId === "object" && !Array.isArray(byId)
      ? Object.entries(byId).map(([key, snapshot]) => summarizeBucket(key, snapshot))
      : [];
  return {
    accountIdPresent: result?.accountId != null,
    ordinaryUsageAllowed:
      typeof result?.ordinaryUsageAllowed === "boolean" ? result.ordinaryUsageAllowed : null,
    limitId: limits.limitId ?? null,
    planTypePresent: limits.planType != null,
    primary: windowOf(limits.primary),
    secondary: windowOf(limits.secondary),
    rateLimitReachedType: limits.rateLimitReachedType ?? null,
    ...spendControlOf(limits),
    credits: creditsOf(limits),
    resetCreditsAvailable:
      typeof result?.rateLimitResetCredits?.availableCount === "number"
        ? result.rateLimitResetCredits.availableCount
        : null,
    buckets,
  };
}

function readOptions(argv) {
  const options = { pages: 1, limit: 20, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pages") options.pages = Number(argv[++i]);
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.pages) || options.pages < 1 || options.pages > 10) {
    throw new Error("--pages must be an integer from 1 to 10");
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  return options;
}

function isPathStart(text, index) {
  if (text.startsWith("~/", index)) return true;
  const previous = text[index - 1];
  if (text.startsWith("\\\\", index) && previous !== "\\" && !/[A-Za-z0-9]/.test(previous ?? "")) {
    return true;
  }
  if (text[index] === "/" && previous !== "/" && previous !== ":") return true;
  if (
    /[A-Za-z]/.test(text[index] ?? "") &&
    text[index + 1] === ":" &&
    (text[index + 2] === "\\" || text[index + 2] === "/") &&
    !/[A-Za-z]/.test(previous ?? "")
  ) {
    return true;
  }
  return false;
}

function pathEnd(text, index) {
  let end = index;
  while (end < text.length) {
    const char = text[end];
    if (char === "`" || char === '"' || char === "\n" || char === "\r") break;
    if (char === " " || char === "\t") {
      const rest = text.slice(end + 1);
      const lineEnd = rest.search(/[\n\r]/);
      const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
      if (line.search(/[`"]/) !== -1) {
        end += 1;
        continue;
      }
      const separatorAhead = line.includes("/") || line.includes("\\");
      const dotAhead = line.split(/\s+/).some((token) => token.includes("."));
      if (separatorAhead || dotAhead) {
        end += 1;
        continue;
      }
      const segment = text.slice(index, end);
      const lastSeparator = Math.max(segment.lastIndexOf("/"), segment.lastIndexOf("\\"));
      const current = lastSeparator === -1 ? segment : segment.slice(lastSeparator + 1);
      if (current.includes(".")) break;
    }
    end += 1;
  }
  return end;
}

/** Redact the whole stderr buffer, then keep the tail. A slice taken first can start mid-path. */
export function stderrDetail(value) {
  return redactDiagnostic(String(value ?? "").trim()).slice(-500);
}

/** Drop local paths and thread ids from text that may be printed. */
export function redactDiagnostic(value) {
  const text = String(value ?? "");
  let redacted = "";
  for (let index = 0; index < text.length;) {
    if (!isPathStart(text, index)) {
      redacted += text[index];
      index += 1;
      continue;
    }
    const end = pathEnd(text, index);
    redacted += "[redacted]";
    index = Math.max(end, index + 1);
  }
  return redacted.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "[redacted]",
  );
}

function rpcError(message) {
  const text = redactDiagnostic(message?.message ?? "");
  if (message?.code != null && text) return { error: `${message.code}: ${text}` };
  if (message?.code != null) return { error: String(message.code) };
  return { error: text || "request failed" };
}

function connect(bin, args = ["app-server", "--listen", "stdio://"]) {
  const child = spawn(bin, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let failure = null;
  const pending = new Map();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-2000);
  });
  child.stderr.on("error", () => {});
  child.stdin.on("error", () => {});

  const rejectPending = (error) => {
    if (failure) return;
    failure = error;
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      pending.delete(id);
      waiter.reject(error);
    }
  };

  child.on("error", (error) => {
    const reason = error.code || redactDiagnostic(error.message);
    rejectPending(new Error(`codex app-server failed to start: ${reason}`));
  });
  child.on("exit", (code, signal) => {
    const why = signal ? `signal ${signal}` : `code ${code}`;
    const detail = stderrDetail(stderr);
    rejectPending(
      new Error(
        detail ? `codex app-server exited (${why}): ${detail}` : `codex app-server exited (${why})`,
      ),
    );
  });

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    const waiter = message.id == null ? undefined : pending.get(message.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(message.id);
    waiter.resolve(message);
  });

  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      assertProbeMethod(method);
      if (failure) {
        reject(failure);
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        const detail = stderrDetail(stderr);
        reject(
          new Error(
            detail ? `timeout waiting for ${method}: ${detail}` : `timeout waiting for ${method}`,
          ),
        );
      }, 20_000);
      pending.set(id, { timer, resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  const notify = (method, params) => {
    assertProbeMethod(method);
    if (failure) throw failure;
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  };

  const stop = () => {
    rl.close();
    if (failure || child.exitCode != null || child.signalCode != null) return;
    child.kill("SIGTERM");
  };

  return { request, notify, stop, child };
}

function dedupeThreads(threads) {
  const seen = new Set();
  const unique = [];
  for (const thread of threads) {
    const id = typeof thread?.id === "string" ? thread.id : "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    unique.push(thread);
  }
  return unique;
}

async function listThreads(client, { pages, limit, archived, idBase, sourceKinds }) {
  const threads = [];
  let more = false;
  let cursor = null;
  for (let page = 0; page < pages; page += 1) {
    const listed = await client.request(idBase + page, "thread/list", {
      limit,
      modelProviders: [],
      useStateDbOnly: true,
      archived,
      ...(sourceKinds ? { sourceKinds } : {}),
      ...(cursor ? { cursor } : {}),
    });
    if (listed.error) return { error: listed.error, threads, more };
    threads.push(...(listed.result?.data ?? []));
    cursor = listed.result?.nextCursor ?? null;
    more = Boolean(cursor);
    if (!cursor) break;
  }
  return { error: null, threads, more };
}

export async function runProbe({
  bin = process.env.CODEX_BIN || "codex",
  args,
  pages = 1,
  limit = 20,
} = {}) {
  const client = connect(bin, args);
  try {
    const init = await client.request(1, "initialize", {
      clientInfo: {
        name: "after-hours-probe",
        title: "After Hours probe",
        version: "0.0.0",
      },
    });
    client.notify("initialized", {});
    if (init.error) return { userAgent: null, threads: rpcError(init.error), rateLimits: null };

    const active = await listThreads(client, { pages, limit, archived: false, idBase: 2 });
    if (active.error) {
      const limits = await client.request(100, "account/rateLimits/read", {});
      return {
        userAgent: init.result?.userAgent ?? null,
        threads: rpcError(active.error),
        rateLimits: limits.error ? rpcError(limits.error) : summarizeRateLimits(limits.result),
      };
    }
    const extra = await listThreads(client, {
      pages,
      limit,
      archived: false,
      idBase: 20,
      sourceKinds: EXTRA_SOURCE_KINDS,
    });
    const archived = await listThreads(client, { pages, limit, archived: true, idBase: 40 });
    const archivedExtra = await listThreads(client, {
      pages,
      limit,
      archived: true,
      idBase: 60,
      sourceKinds: EXTRA_SOURCE_KINDS,
    });

    const limits = await client.request(100, "account/rateLimits/read", {});
    const extraError = extra.error ?? archivedExtra.error;
    const archivedError = archived.error ?? archivedExtra.error;
    return {
      userAgent: init.result?.userAgent ?? null,
      threads: {
        ...summarizeThreads(
          dedupeThreads([
            ...active.threads,
            ...(extra.error ? [] : extra.threads),
            ...(archived.error ? [] : archived.threads),
            ...(archivedExtra.error ? [] : archivedExtra.threads),
          ]),
        ),
        more:
          active.more ||
          (!extra.error && extra.more) ||
          (!archived.error && archived.more) ||
          (!archivedExtra.error && archivedExtra.more),
        scope: "interactive",
        extraSourcesIncluded: !extra.error && !archivedExtra.error,
        archivedIncluded: !archived.error && !archivedExtra.error,
        ...(extraError ? { extraSourceError: rpcError(extraError).error } : {}),
        ...(archivedError ? { archivedError: rpcError(archivedError).error } : {}),
      },
      rateLimits: limits.error ? rpcError(limits.error) : summarizeRateLimits(limits.result),
    };
  } finally {
    client.stop();
  }
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/codex-app-server-probe.mjs [--pages N] [--limit N]\n" +
        "Reads the default interactive thread list plus exec, appServer, and unknown, including archived threads. Sub-agent threads are not included. Does not start a model turn.\n",
    );
    return;
  }
  const summary = await runProbe(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (
    summary.threads?.error ||
    summary.threads?.archivedError ||
    summary.threads?.extraSourceError ||
    summary.rateLimits?.error
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
