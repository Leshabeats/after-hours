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

function labelHasUriPath(text) {
  const scheme = /([A-Za-z][A-Za-z0-9+.-]*):\/\//g;
  let match;
  while ((match = scheme.exec(text))) {
    if (/[A-Za-z0-9]/.test(text[match.index - 1] ?? "")) continue;
    if (match[1].toLowerCase() === "file") continue;
    let cursor = match.index + match[0].length;
    if (cursor >= text.length || text[cursor] === "/" || text[cursor] === "\\") continue;
    while (cursor < text.length && !/[\s"'`<>]/.test(text[cursor])) {
      if (text[cursor] === "/" || text[cursor] === "\\") return true;
      cursor += 1;
    }
  }
  return false;
}

function publicLabel(value) {
  const text = String(value);
  if (labelHasUriPath(text)) return "[redacted]";
  const redacted = redactDiagnostic(text);
  return redacted === text ? text : "[redacted]";
}

function sourceLabel(source) {
  if (typeof source === "string") return source;
  if (source && typeof source === "object") {
    if (typeof source.custom === "string") {
      const label = publicLabel(source.custom);
      return label === "[redacted]" ? label : `custom:${label}`;
    }
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
  return publicLabel(origin);
}

/** Counts only. Thread titles, previews, paths, and ids are not copied. */
export function summarizeThreads(threads) {
  const sources = emptyCounts();
  const originators = emptyCounts();
  const statuses = emptyCounts();
  let missingOriginators = 0;
  let uuidIds = 0;
  for (const thread of threads) {
    bump(sources, sourceLabel(thread?.source));
    if (thread?.originator == null) missingOriginators += 1;
    else bump(originators, originLabel(thread.originator));
    bump(statuses, statusLabel(thread?.status));
    if (typeof thread?.id === "string" && UUID.test(thread.id)) uuidIds += 1;
  }
  return {
    count: threads.length,
    uuidIds,
    sources,
    missingOriginators,
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

function plainSchemeEnd(text, index) {
  if (/[A-Za-z0-9]/.test(text[index - 1] ?? "")) return -1;
  if (!/[A-Za-z]/.test(text[index] ?? "")) return -1;
  let cursor = index + 1;
  while (cursor < text.length && /[A-Za-z0-9+.-]/.test(text[cursor])) cursor += 1;
  return cursor;
}

/** Copy a remote URI with a real host. Stop before a colon that starts a local path. */
function remoteUriEnd(text, index) {
  const schemeEnd = plainSchemeEnd(text, index);
  if (schemeEnd < 0) return -1;
  if (text[schemeEnd] !== ":" || text[schemeEnd + 1] !== "/" || text[schemeEnd + 2] !== "/") {
    return -1;
  }
  if (text.slice(index, schemeEnd).toLowerCase() === "file") return -1;
  let cursor = schemeEnd + 3;
  if (cursor >= text.length || /[/\\\s"'`<>]/.test(text[cursor])) return -1;
  while (cursor < text.length && !/[\s"'`<>]/.test(text[cursor])) {
    if (text[cursor] === ":") {
      const next = text[cursor + 1] ?? "";
      const after = text[cursor + 2] ?? "";
      if (
        next === "/" ||
        next === "\\" ||
        (next === "~" && isTildePath(text, cursor + 1)) ||
        (/[A-Za-z]/.test(next) && (after === "/" || after === "\\"))
      ) {
        return cursor;
      }
    }
    cursor += 1;
  }
  return cursor;
}

function isEmptyHostPath(text, index) {
  if (text[index] !== "/" && text[index] !== "\\") return false;
  return /(?:^|[^A-Za-z0-9])(?!file:)[A-Za-z][A-Za-z0-9+.-]*:\/\/$/i.test(text.slice(0, index));
}

function isTildePath(text, index) {
  if (text[index] !== "~") return false;
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "/" || char === "\\") return true;
    if (
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === "`" ||
      char === '"'
    ) {
      return false;
    }
    cursor += 1;
  }
  return false;
}

function isPathStart(text, index) {
  if (isEmptyHostPath(text, index)) return true;
  if (isTildePath(text, index) && !/[A-Za-z0-9]/.test(text[index - 1] ?? "")) return true;
  const previous = text[index - 1];
  if (text.startsWith("\\\\", index) && previous !== "\\" && !/[A-Za-z0-9]/.test(previous ?? "")) {
    return true;
  }
  if (text[index] === "\\" && previous !== "\\" && !/[A-Za-z0-9]/.test(previous ?? "")) {
    let firstDot = false;
    let inFirst = true;
    for (let cursor = index + 1; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (char === "\n" || char === "\r" || char === "`" || char === '"') break;
      if (char === "\\" || char === "/") return true;
      if (char === " " || char === "\t") inFirst = false;
      else if (inFirst && char === ".") firstDot = true;
    }
    if (firstDot) return true;
  }
  if (
    text.slice(index, index + 7).toLowerCase() === "file://" &&
    !/[A-Za-z0-9]/.test(previous ?? "")
  ) {
    return true;
  }
  if (
    text[index] === "/" &&
    previous !== "/" &&
    !/[A-Za-z0-9]/.test(previous ?? "") &&
    !(previous === ":" && text[index + 1] === "/")
  ) {
    return true;
  }
  if (
    /[A-Za-z]/.test(text[index] ?? "") &&
    text[index + 1] === ":" &&
    (text[index + 2] === "\\" || text[index + 2] === "/") &&
    !/[A-Za-z]/.test(previous ?? "")
  ) {
    return true;
  }
  return isRelativeWindowsPath(text, index);
}

function nextTokenContinuesPath(text, cursor) {
  let look = cursor + 1;
  while (look < text.length && (text[look] === " " || text[look] === "\t")) look += 1;
  for (; look < text.length; look += 1) {
    const next = text[look];
    if (
      next === "\n" ||
      next === "\r" ||
      next === "`" ||
      next === '"' ||
      next === " " ||
      next === "\t"
    ) {
      return false;
    }
    if (next === "\\" || next === ".") return true;
  }
  return false;
}

function relativeWindowsBody(text, index) {
  let separators = 0;
  let componentHasDot = false;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === "\n" || char === "\r" || char === "`" || char === '"') break;
    if (char === "\\") {
      separators += 1;
      componentHasDot = false;
      continue;
    }
    if (char === " " || char === "\t") {
      if (separators === 0 || !nextTokenContinuesPath(text, cursor)) break;
      continue;
    }
    if (char === "." && separators >= 1) componentHasDot = true;
  }
  return separators >= 2 || (separators >= 1 && componentHasDot);
}

function isRelativeWindowsPath(text, index) {
  if (!/[A-Za-z0-9]/.test(text[index] ?? "")) return false;
  if (/[A-Za-z0-9]/.test(text[index - 1] ?? "")) return false;
  if (relativeWindowsBody(text, index)) return true;
  if (text[index] === text[index].toLowerCase()) return false;
  let cursor = index;
  while (cursor < text.length && text[cursor] !== " " && text[cursor] !== "\t") cursor += 1;
  if (text[cursor] !== " " && text[cursor] !== "\t") return false;
  let next = cursor + 1;
  while (text[next] === " " || text[next] === "\t") next += 1;
  if (!/[A-Za-z0-9]/.test(text[next] ?? "")) return false;
  return relativeWindowsBody(text, next);
}

function pathEnd(text, index) {
  let lineEnd = index;
  let closer = -1;
  while (lineEnd < text.length) {
    const char = text[lineEnd];
    if (char === "\n" || char === "\r") break;
    if (closer === -1 && (char === "`" || char === '"')) closer = lineEnd;
    lineEnd += 1;
  }
  if (closer !== -1) return closer;

  let lastRequired = index;
  let cursor = index;
  while (cursor < lineEnd) {
    const char = text[cursor];
    if (char === " " || char === "\t") {
      cursor += 1;
      continue;
    }
    let hasSeparator = false;
    let hasDot = false;
    while (cursor < lineEnd && text[cursor] !== " " && text[cursor] !== "\t") {
      if (text[cursor] === "/" || text[cursor] === "\\") hasSeparator = true;
      if (text[cursor] === ".") hasDot = true;
      cursor += 1;
    }
    if (hasSeparator || hasDot) lastRequired = cursor;
  }

  let lastSeparator = -1;
  for (let scan = index; scan < lineEnd; scan += 1) {
    if (text[scan] === "/" || text[scan] === "\\") lastSeparator = scan;
  }
  for (let scan = lastSeparator + 1; scan < lineEnd; scan += 1) {
    if (text[scan] === ".") return lastRequired;
  }
  return lineEnd;
}

const STDERR_LINE_LIMIT = 100_000;

/**
 * Keep raw stderr only until a line can be redacted whole.
 * A rolling slice of the raw bytes can drop the leading `/` of a long path.
 */
function firstBreak(text) {
  const newline = text.indexOf("\n");
  const carriage = text.indexOf("\r");
  if (newline === -1) return carriage;
  if (carriage === -1) return newline;
  return Math.min(newline, carriage);
}

export function retainStderr(state, chunk) {
  let text = String(chunk ?? "");
  if (state.discardLine) {
    const breakAt = firstBreak(text);
    if (breakAt === -1) return state;
    state.discardLine = false;
    text = text.slice(breakAt + 1);
  }
  state.pending += text;
  const breakAt = Math.max(state.pending.lastIndexOf("\n"), state.pending.lastIndexOf("\r"));
  if (breakAt !== -1) {
    const complete = state.pending.slice(0, breakAt + 1);
    state.pending = state.pending.slice(breakAt + 1);
    state.safe = `${state.safe}${redactDiagnostic(complete)}`.slice(-2000);
  }
  if (state.pending.length > STDERR_LINE_LIMIT) {
    state.safe = `${state.safe}${redactDiagnostic(state.pending)}`.slice(-2000);
    state.pending = "";
    state.discardLine = true;
  }
  return state;
}

export function stderrText(state) {
  return `${state?.safe ?? ""}${state?.pending ?? ""}`;
}

/** Redact the whole stderr buffer, then keep the tail. A slice taken first can start mid-path. */
export function stderrDetail(value) {
  return redactDiagnostic(String(value ?? "").trim()).slice(-500);
}

function cutAt(text, marks) {
  let end = text.length;
  for (const mark of marks) {
    const at = text.indexOf(mark);
    if (at !== -1 && at < end) end = at;
  }
  return end;
}

/** Keep the scheme, host, port, and path. Drop userinfo, query, and fragment. */
function shareableUri(uri) {
  const scheme = uri.indexOf("://");
  if (scheme < 0) return uri;
  const rest = uri.slice(scheme + 3);
  const authorityEnd = cutAt(rest, ["/", "?", "#"]);
  const authority = rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf("@");
  const host = at === -1 ? authority : authority.slice(at + 1);
  const path =
    rest[authorityEnd] === "/"
      ? rest.slice(authorityEnd, authorityEnd + cutAt(rest.slice(authorityEnd), ["?", "#"]))
      : "";
  return `${uri.slice(0, scheme + 3)}${host}${path}`;
}

/** Drop local paths, emails, and thread ids from text that may be printed. */
export function redactDiagnostic(value) {
  const text = String(value ?? "");
  let redacted = "";
  for (let index = 0; index < text.length;) {
    const uriEnd = remoteUriEnd(text, index);
    if (uriEnd > index) {
      redacted += shareableUri(text.slice(index, uriEnd));
      index = uriEnd;
      continue;
    }
    const plainEnd = plainSchemeEnd(text, index);
    if (plainEnd > index && text[plainEnd] !== ":" && !isRelativeWindowsPath(text, index)) {
      redacted += text.slice(index, plainEnd);
      index = plainEnd;
      continue;
    }
    if (!isPathStart(text, index)) {
      redacted += text[index];
      index += 1;
      continue;
    }
    const end = pathEnd(text, index);
    redacted += "[redacted]";
    index = Math.max(end, index + 1);
  }
  return redactEmails(redacted).replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "[redacted]",
  );
}

const EMAIL_LOCAL = /[\p{L}0-9._%+\-'\u2019]/u;
const EMAIL_DOMAIN = /[\p{L}0-9.-]/u;
const EMAIL_TLD = /^\p{L}+$/u;
const EMAIL_PUNYCODE_TLD = /^xn--[a-z0-9-]{2,}$/i;

function isEmailTld(label) {
  return EMAIL_TLD.test(label) || EMAIL_PUNYCODE_TLD.test(label);
}

/** Find addresses from each @. A greedy local-part regex retries every character of a long line. */
function redactEmails(text) {
  let redacted = "";
  let cursor = 0;
  for (let at = text.indexOf("@", cursor); at !== -1; at = text.indexOf("@", cursor)) {
    let local = at;
    while (local > cursor && EMAIL_LOCAL.test(text[local - 1])) local -= 1;
    let domain = at + 1;
    while (domain < text.length && EMAIL_DOMAIN.test(text[domain])) domain += 1;
    const end = local < at ? emailEnd(text, at, domain) : -1;
    if (end !== -1) {
      redacted += `${text.slice(cursor, local)}[redacted]`;
      cursor = end;
    } else {
      redacted += text.slice(cursor, at + 1);
      cursor = at + 1;
    }
  }
  return redacted + text.slice(cursor);
}

/** One pass over the dots. A label followed by @ belongs to the next address. */
function emailEnd(text, at, domain) {
  const dots = [];
  for (let index = at + 1; index < domain; index += 1) {
    if (text[index] === ".") dots.push(index);
  }
  for (let index = dots.length - 1; index >= 0; index -= 1) {
    const dot = dots[index];
    if (dot <= at + 1) continue;
    const labelEnd = index + 1 < dots.length ? dots[index + 1] : domain;
    const tld = text.slice(dot + 1, labelEnd);
    if (tld.length < 2 || !isEmailTld(tld)) continue;
    if (text[labelEnd] === "@") continue;
    return labelEnd;
  }
  return -1;
}

function rpcError(message) {
  const text = redactDiagnostic(message?.message ?? "");
  if (message?.code != null && text) return { error: `${message.code}: ${text}` };
  if (message?.code != null) return { error: String(message.code) };
  return { error: text || "request failed" };
}

/** A stdin failure still leaves a live pid. Only a finished child or a failed spawn is left alone. */
export function shouldKillChild(child) {
  return child?.exitCode == null && child?.signalCode == null && child?.pid != null;
}

function killDirect(child) {
  if (!shouldKillChild(child)) return false;
  try {
    child.kill("SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  return true;
}

export function terminateChild(child, platform = process.platform, launch = spawn) {
  if (!shouldKillChild(child)) return false;
  if (platform !== "win32") return killDirect(child);
  let killer;
  try {
    killer = launch("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    return killDirect(child);
  }
  if (!killer || typeof killer.on !== "function") return true;
  killer.on("error", () => {
    killDirect(child);
  });
  killer.on("exit", (code) => {
    if (code) killDirect(child);
  });
  killer.unref?.();
  return true;
}

export function stopChild(child, platform = process.platform, launch = spawn) {
  const stdin = child?.stdin;
  if (stdin && !stdin.destroyed) {
    try {
      stdin.end();
    } catch (error) {
      if (error?.code !== "EPIPE" && error?.code !== "ERR_STREAM_DESTROYED") throw error;
    }
  }
  return terminateChild(child, platform, launch);
}

export function bindStdin(stdin, rejectPending) {
  stdin.on("error", (error) => {
    rejectPending(new Error(`codex app-server stdin failed: ${error?.code || "unknown"}`));
  });
}

function quoteCmd(value) {
  const text = String(value);
  if (text.length === 0 || /[\s"&|<>^%]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** A Windows npm shim is codex.cmd. cmd.exe can start it; spawn cannot. */
export function appServerLaunch(bin, args = [], platform = process.platform) {
  if (platform !== "win32") return { command: bin, args, verbatim: false };
  const commandLine = [bin, ...args].map(quoteCmd).join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    verbatim: true,
  };
}

export function formatFailure(error) {
  return redactDiagnostic(error instanceof Error ? error.message : String(error));
}

function shareableUserAgent(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return publicLabel(value);
}

function connect(bin, args = ["app-server", "--listen", "stdio://"]) {
  const launch = appServerLaunch(bin, args);
  const child = spawn(launch.command, launch.args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...(launch.verbatim ? { windowsVerbatimArguments: true } : {}),
  });
  const stderrState = { safe: "", pending: "" };
  let failure = null;
  const pending = new Map();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    retainStderr(stderrState, chunk);
  });
  child.stderr.on("error", () => {});

  const rejectPending = (error) => {
    if (failure) return;
    failure = error;
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      pending.delete(id);
      waiter.reject(error);
    }
  };

  bindStdin(child.stdin, rejectPending);

  child.on("error", (error) => {
    const reason = error.code || redactDiagnostic(error.message);
    rejectPending(new Error(`codex app-server failed to start: ${reason}`));
  });
  child.on("exit", (code, signal) => {
    const why = signal ? `signal ${signal}` : `code ${code}`;
    const detail = stderrDetail(stderrText(stderrState));
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
        const detail = stderrDetail(stderrText(stderrState));
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
    stopChild(child);
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
        userAgent: shareableUserAgent(init.result?.userAgent),
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
    return {
      userAgent: shareableUserAgent(init.result?.userAgent),
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
        extraSourcesIncluded: !extra.error,
        archivedIncluded: !archived.error,
        archivedExtraIncluded: !archivedExtra.error,
        ...(extra.error ? { extraSourceError: rpcError(extra.error).error } : {}),
        ...(archived.error ? { archivedError: rpcError(archived.error).error } : {}),
        ...(archivedExtra.error ? { archivedExtraError: rpcError(archivedExtra.error).error } : {}),
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
    summary.threads?.archivedExtraError ||
    summary.threads?.extraSourceError ||
    summary.rateLimits?.error
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${formatFailure(error)}\n`);
    process.exitCode = 1;
  });
}
