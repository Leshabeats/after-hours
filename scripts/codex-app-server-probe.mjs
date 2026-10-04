import { spawn } from "node:child_process";
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

function labelStops(char) {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === '"' ||
    char === "'" ||
    char === "`" ||
    char === "<" ||
    char === ">"
  );
}

/** One pass. A scheme run without :// is not retried from every letter. */
function labelHasUriPath(text) {
  let cursor = 0;
  while (cursor < text.length) {
    const schemeEnd = plainSchemeEnd(text, cursor);
    if (schemeEnd <= cursor) {
      cursor += 1;
      continue;
    }
    if (text[schemeEnd] !== ":" || text[schemeEnd + 1] !== "/" || text[schemeEnd + 2] !== "/") {
      cursor = schemeEnd;
      continue;
    }
    if (text.slice(cursor, schemeEnd).toLowerCase() === "file") {
      cursor = schemeEnd + 3;
      continue;
    }
    let host = schemeEnd + 3;
    if (host >= text.length || text[host] === "/" || text[host] === "\\") {
      cursor = host + 1;
      continue;
    }
    while (host < text.length && !labelStops(text[host])) {
      if (text[host] === "/" || text[host] === "\\") return true;
      host += 1;
    }
    cursor = host + 1;
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

let schemeText = null;
let schemeEnds = null;

/** One pass. Every scheme start in a token shares that token's end. */
function plainSchemeEnd(text, index) {
  if (schemeText !== text) {
    schemeText = text;
    schemeEnds = new Int32Array(text.length);
    schemeEnds.fill(-1);
    let cursor = 0;
    while (cursor < text.length) {
      if (/[A-Za-z0-9]/.test(text[cursor - 1] ?? "") || !/[A-Za-z]/.test(text[cursor] ?? "")) {
        cursor += 1;
        continue;
      }
      let end = cursor + 1;
      while (end < text.length && /[A-Za-z0-9+.-]/.test(text[end])) end += 1;
      schemeEnds[cursor] = end;
      for (let mark = cursor + 1; mark < end; mark += 1) {
        if (/[A-Za-z]/.test(text[mark]) && !/[A-Za-z0-9]/.test(text[mark - 1] ?? "")) {
          schemeEnds[mark] = end;
        }
      }
      cursor = end;
    }
  }
  return schemeEnds[index] ?? -1;
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
        (/[A-Za-z]/.test(next) && (after === "/" || after === "\\")) ||
        isDriveRelativePath(text, cursor + 1)
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
  if (text[index - 1] !== "/" || text[index - 2] !== "/" || text[index - 3] !== ":") return false;
  let end = index - 4;
  let start = end;
  while (start >= 0 && /[A-Za-z0-9+.-]/.test(text[start])) start -= 1;
  start += 1;
  if (start > end || !/[A-Za-z]/.test(text[start] ?? "")) return false;
  if (/[A-Za-z0-9]/.test(text[start - 1] ?? "")) return false;
  return text.slice(start, end + 1).toLowerCase() !== "file";
}

let tildeText = null;
let tildePaths = null;

function tildeStops(char) {
  return (
    char === " " || char === "\t" || char === "\n" || char === "\r" || char === "`" || char === '"'
  );
}

/** One pass. A later `~` stays inside the token when a slash follows it. */
function isTildePath(text, index) {
  if (text[index] !== "~") return false;
  if (tildeText !== text) {
    tildeText = text;
    tildePaths = new Uint8Array(text.length);
    let cursor = 0;
    while (cursor < text.length) {
      if (text[cursor] !== "~" || /[A-Za-z0-9]/.test(text[cursor - 1] ?? "")) {
        cursor += 1;
        continue;
      }
      let end = cursor + 1;
      let slash = -1;
      while (end < text.length && !tildeStops(text[end])) {
        if (text[end] === "/" || text[end] === "\\") {
          slash = end;
          break;
        }
        end += 1;
      }
      if (slash !== -1) {
        for (let mark = cursor; mark < slash; mark += 1) {
          if (text[mark] === "~" && !/[A-Za-z0-9]/.test(text[mark - 1] ?? "")) {
            tildePaths[mark] = 1;
          }
        }
        cursor = slash + 1;
      } else {
        cursor = Math.max(end, cursor + 1);
      }
    }
  }
  return tildePaths[index] === 1;
}

function isPathStart(text, index) {
  if (isEmptyHostPath(text, index)) return true;
  if (isTildePath(text, index) && !/[A-Za-z0-9]/.test(text[index - 1] ?? "")) return true;
  const previous = text[index - 1];
  if (text.startsWith("\\\\", index) && previous !== "\\" && !/[A-Za-z0-9]/.test(previous ?? "")) {
    return true;
  }
  if (text[index] === "\\" && previous !== "\\" && !isWordChar(previous)) {
    let firstDot = false;
    let inFirst = true;
    let firstLength = 0;
    for (let cursor = index + 1; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (char === "\n" || char === "\r" || char === "`" || char === '"') break;
      if (char === "\\" || char === "/") return true;
      if (char === " " || char === "\t") inFirst = false;
      else if (!inFirst) continue;
      else if (char === ".") firstDot = true;
      else if (isWordChar(char)) firstLength += 1;
      else break;
    }
    if (firstDot || firstLength >= 2) return true;
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
    !isWordChar(previous) &&
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
  if (isDriveRelativePath(text, index)) return true;
  return isRelativeWindowsPath(text, index) || isRelativePosixPath(text, index);
}

let driveText = null;
let drivePaths = null;
let driveEnds = null;
const NO_DRIVE = new Uint8Array(0);

function driveTokenEnd(text, index) {
  let end = index;
  let dot = false;
  let sep = false;
  let nameLen = 0;
  while (end < text.length) {
    const char = text[end];
    if (
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === '"' ||
      char === "`" ||
      char === ":"
    ) {
      break;
    }
    if (char === ".") dot = true;
    else if (char === "\\" || char === "/") sep = true;
    else nameLen += 1;
    end += 1;
  }
  return { end, dot, sep, nameLen };
}

/**
 * One pass. `C:name` is a file on that drive's current directory.
 * A later word stays only when that word itself has a dot or a separator.
 * `pathEnd` would keep the rest of a line whose last segment has no dot.
 */
function scanDriveRelative(text) {
  if (driveText === text) return;
  driveText = text;
  if (!text.includes(":")) {
    drivePaths = NO_DRIVE;
    driveEnds = NO_DRIVE;
    return;
  }
  drivePaths = new Uint8Array(text.length);
  driveEnds = new Int32Array(text.length);
  let cursor = 0;
  while (cursor < text.length) {
    const after = text[cursor + 2] ?? "";
    if (
      !/[A-Za-z]/.test(text[cursor] ?? "") ||
      /[A-Za-z]/.test(text[cursor - 1] ?? "") ||
      text[cursor + 1] !== ":" ||
      after === "" ||
      after === "\\" ||
      after === "/" ||
      after === " " ||
      after === "\t"
    ) {
      cursor += 1;
      continue;
    }
    const token = driveTokenEnd(text, cursor + 2);
    // One letter is the `a:a:a` chain, not a file name. Keep scanning so `a:C:secret` still sees `C`.
    if (!(token.dot || token.sep || token.nameLen >= 2)) {
      cursor += 1;
      continue;
    }
    let end = token.end;
    while (end < text.length && (text[end] === " " || text[end] === "\t")) {
      let next = end;
      while (text[next] === " " || text[next] === "\t") next += 1;
      if (next >= text.length || text[next] === "\n" || text[next] === "\r") break;
      const piece = driveTokenEnd(text, next);
      if (!(piece.dot || piece.sep) || piece.end === next) break;
      end = piece.end;
    }
    drivePaths[cursor] = 1;
    driveEnds[cursor] = end;
    cursor = end;
  }
}

function isDriveRelativePath(text, index) {
  scanDriveRelative(text);
  return drivePaths[index] === 1;
}

function driveRelativeEnd(text, index) {
  scanDriveRelative(text);
  const end = driveEnds[index];
  return end > index ? end : index + 1;
}

/**
 * One reverse pass. A `\\` starts a body when another `\\` or `.` remains later
 * in the same segment. Spaces stay inside the segment only while that tail exists.
 */
function windowsBodyAt(text) {
  const body = new Uint8Array(text.length);
  let seenRight = false;
  let qualifies = false;
  for (let cursor = text.length - 1; cursor >= 0; cursor -= 1) {
    const char = text[cursor];
    if (
      char === "\n" ||
      char === "\r" ||
      char === "`" ||
      char === '"' ||
      char === ":" ||
      char === "="
    ) {
      seenRight = false;
      qualifies = false;
      continue;
    }
    if (char === " " || char === "\t") {
      qualifies = false;
      continue;
    }
    if (char === "\\") {
      qualifies = seenRight;
      seenRight = true;
      continue;
    }
    if (char === ".") seenRight = true;
    if (qualifies) body[cursor] = 1;
  }
  return body;
}

function isWordChar(char) {
  return /[\p{L}\p{N}]/u.test(char ?? "");
}

function isWordStart(text, index) {
  return isWordChar(text[index]) && !isWordChar(text[index - 1]);
}

function wordTokenHas(text, index, mark) {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === "`" ||
      char === '"' ||
      char === ":" ||
      char === "="
    ) {
      return false;
    }
    if (char === mark) return true;
  }
  return false;
}

function wordsStayOnOneLine(text, left, right) {
  for (let cursor = left; cursor < right; cursor += 1) {
    const char = text[cursor];
    if (
      char === "\n" ||
      char === "\r" ||
      char === "`" ||
      char === '"' ||
      char === ":" ||
      char === "=" ||
      char === "~" ||
      char === "/"
    ) {
      return false;
    }
  }
  return true;
}

const PATH_CLAUSE = new Set([
  "Cannot",
  "Error",
  "Failed",
  "Failure",
  "From",
  "Is",
  "Missing",
  "Open",
  "See",
  "The",
]);

let windowsStartText = null;
let windowsStarts = null;

function wordText(text, index) {
  let end = index;
  while (end < text.length && isWordChar(text[end])) end += 1;
  return text.slice(index, end);
}

/** One pass over word starts. A later path must not pull in every earlier word. */
function windowsPathStarts(text) {
  if (windowsStartText === text) return windowsStarts;
  windowsStartText = text;
  windowsStarts = new Uint8Array(text.length);
  if (!text.includes("\\")) return windowsStarts;
  const words = [];
  for (let index = 0; index < text.length; index += 1) {
    if (isWordStart(text, index)) words.push(index);
  }
  const bodyAt = windowsBodyAt(text);
  for (let index = 0; index < words.length; index += 1) {
    if (bodyAt[words[index]] !== 1) continue;
    const start = words[index];
    windowsStarts[start] = 1;
    const upper = text[start] !== text[start].toLowerCase();
    const dottedToken = wordTokenHas(text, start, "\\") && wordTokenHas(text, start, ".");
    let previous = index - 1;
    if (upper) {
      const run = [];
      let right = start;
      while (previous >= 0 && bodyAt[words[previous]] !== 1) {
        const word = words[previous];
        if (!wordsStayOnOneLine(text, word, right)) break;
        if (text[word] === text[word].toLowerCase()) break;
        if (PATH_CLAUSE.has(wordText(text, word))) break;
        run.push(word);
        right = word;
        previous -= 1;
      }
      for (const word of run) windowsStarts[word] = 1;
      continue;
    }
    if (!dottedToken || previous < 0 || bodyAt[words[previous]] === 1) continue;
    const word = words[previous];
    if (!wordsStayOnOneLine(text, word, start)) continue;
    if (text[word] !== text[word].toLowerCase()) continue;
    windowsStarts[word] = 1;
  }
  return windowsStarts;
}

function isRelativeWindowsPath(text, index) {
  if (!isWordStart(text, index)) return false;
  return windowsPathStarts(text)[index] === 1;
}

/** A version slash such as `codex_cli_rs/0.159.0` or `node/v22.0.0`. */
function isVersionSlash(text, index) {
  let cursor = index;
  if (text[cursor] === "v" || text[cursor] === "V") cursor += 1;
  if (!/\d/.test(text[cursor] ?? "")) return false;
  while (/\d/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] !== ".") return false;
  cursor += 1;
  return /\d/.test(text[cursor] ?? "");
}

function isPathTokenChar(char) {
  return (
    isWordChar(char) ||
    char === "." ||
    char === "_" ||
    char === "-" ||
    char === "+" ||
    char === "'" ||
    char === "\u2019"
  );
}

let posixText = null;
let posixAt = null;

function isRelativePosixPath(text, index) {
  if (!isWordStart(text, index)) return false;
  if (posixText !== text) {
    posixText = text;
    posixAt = new Uint8Array(text.length);
    let cursor = 0;
    while (cursor < text.length) {
      if (!isWordStart(text, cursor)) {
        cursor += 1;
        continue;
      }
      let end = cursor;
      const slashes = [];
      let stoppedOnBackslash = false;
      while (end < text.length) {
        const char = text[end];
        if (char === "\\") {
          stoppedOnBackslash = true;
          break;
        }
        if (!isPathTokenChar(char) && char !== "/") break;
        if (char === "/") slashes.push(end);
        end += 1;
      }
      if (slashes.length > 0) {
        const lastSlash = slashes[slashes.length - 1];
        const twoSlashAt = slashes.length >= 2 ? slashes[slashes.length - 2] : -1;
        let dotAfterLast = false;
        for (let dot = lastSlash + 1; dot < end; dot += 1) {
          if (text[dot] === ".") {
            dotAfterLast = true;
            break;
          }
        }
        const lastIsVersion = isVersionSlash(text, lastSlash + 1);
        const dottedSlash = !stoppedOnBackslash || slashes.length >= 2;
        for (let mark = cursor; mark < end; mark += 1) {
          if (!isWordStart(text, mark)) continue;
          if (twoSlashAt !== -1 && mark <= twoSlashAt) posixAt[mark] = 1;
          else if (dottedSlash && mark <= lastSlash && dotAfterLast && !lastIsVersion) posixAt[mark] = 1;
        }
      }
      cursor = Math.max(end, cursor + 1);
    }
  }
  return posixAt[index] === 1;
}

const LOWER_ROOT_WORD = new Set(["documents", "документы"]);

/** A following word may extend an extensionless root. Punctuation ends it. */
function extensionlessWord(text, index, lineEnd) {
  let cursor = index;
  while (cursor < lineEnd && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
  if (cursor >= lineEnd) return null;
  const char = text[cursor];
  if (char === "\\" || char === "/" || char === ".") return { defer: true };
  if (char === "(") {
    const close = text.indexOf(")", cursor + 1);
    if (close === -1 || close >= lineEnd) return { end: index };
    if (/\s/.test(text.slice(cursor + 1, close))) return { end: index };
    let after = close + 1;
    while (after < lineEnd && (text[after] === " " || text[after] === "\t")) after += 1;
    const follow = text[after] ?? "";
    if (follow === "\\" || follow === "/" || follow === ".") return { defer: true };
    return { end: close + 1, group: true };
  }
  if (!isWordChar(char)) return { end: index };
  let wordEnd = cursor + 1;
  while (wordEnd < lineEnd && isWordChar(text[wordEnd])) wordEnd += 1;
  if (text[wordEnd] === "\\" || text[wordEnd] === "/" || text[wordEnd] === ".")
    return { defer: true };
  return {
    end: wordEnd,
    word: text.slice(cursor, wordEnd),
    capitalized: char !== char.toLowerCase(),
  };
}

/** Stop an extensionless root before punctuation or the failure clause. */
function extensionlessRootEnd(text, index, lineEnd) {
  if (text[index] !== "\\") return -1;
  let cursor = index + 1;
  let length = 0;
  while (cursor < lineEnd) {
    const char = text[cursor];
    if (char === "\\" || char === "/" || char === ".") return -1;
    if (char === " " || char === "\t") break;
    if (!isWordChar(char)) return length >= 2 ? cursor : -1;
    length += 1;
    cursor += 1;
  }
  if (length < 2) return -1;
  let allowLower = true;
  while (cursor < lineEnd && (text[cursor] === " " || text[cursor] === "\t")) {
    const next = extensionlessWord(text, cursor, lineEnd);
    if (!next) return lineEnd;
    if (next.defer) return -1;
    if (next.group) {
      cursor = next.end;
      continue;
    }
    if (next.end === cursor) return cursor;
    const lower = next.word.toLowerCase();
    if (next.capitalized) {
      allowLower = false;
      cursor = next.end;
      continue;
    }
    if (lower === "and") {
      const follow = extensionlessWord(text, next.end, lineEnd);
      if (follow?.capitalized) {
        allowLower = false;
        cursor = next.end;
        continue;
      }
      return cursor;
    }
    if (allowLower && LOWER_ROOT_WORD.has(lower)) {
      allowLower = false;
      cursor = next.end;
      continue;
    }
    return cursor;
  }
  return cursor;
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
  const rootEnd = extensionlessRootEnd(text, index, lineEnd);
  if (rootEnd > index) return rootEnd;

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
    if (
      plainEnd > index &&
      text[plainEnd] !== ":" &&
      !isRelativeWindowsPath(text, index) &&
      !isRelativePosixPath(text, index)
    ) {
      redacted += text.slice(index, plainEnd);
      index = plainEnd;
      continue;
    }
    if (isDriveRelativePath(text, index)) {
      redacted += "[redacted]";
      index = driveRelativeEnd(text, index);
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

function addressLiteralEnd(text, at) {
  if (text[at + 1] !== "[") return -1;
  const close = text.indexOf("]", at + 2);
  if (close === -1) return -1;
  const body = text.slice(at + 2, close);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(body)) return close + 1;
  if (/^IPv6:[0-9A-Fa-f:.]+$/i.test(body) && body.includes(":")) return close + 1;
  return -1;
}

function quotedLocalStart(text, at, floor) {
  if (text[at - 1] !== '"') return -1;
  for (let index = at - 2; index >= floor; index -= 1) {
    const char = text[index];
    if (char === "\n" || char === "\r") return -1;
    if (char === '"' && text[index - 1] !== "\\") return index;
  }
  return -1;
}

/** A quoted local part may contain `@`. The separator is the `@` after the closing quote. */
function quotedMailboxEnd(text, open) {
  let close = -1;
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n" || char === "\r") return -1;
    if (char === '"' && text[index - 1] !== "\\") {
      close = index;
      break;
    }
  }
  if (close === -1 || text[close + 1] !== "@") return -1;
  const at = close + 1;
  const literal = addressLiteralEnd(text, at);
  if (literal !== -1) return literal;
  let domain = at + 1;
  while (domain < text.length && EMAIL_DOMAIN.test(text[domain])) domain += 1;
  return emailEnd(text, at, domain);
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
  while (cursor < text.length) {
    const quote = text.indexOf('"', cursor);
    const at = text.indexOf("@", cursor);
    if (quote !== -1 && text[quote - 1] !== "\\" && (at === -1 || quote < at)) {
      const end = quotedMailboxEnd(text, quote);
      if (end > quote) {
        redacted += `${text.slice(cursor, quote)}[redacted]`;
        cursor = end;
        continue;
      }
      redacted += text.slice(cursor, quote + 1);
      cursor = quote + 1;
      continue;
    }
    if (at === -1) break;
    const quoted = quotedLocalStart(text, at, cursor);
    let local = quoted === -1 ? at : quoted;
    while (quoted === -1 && local > cursor && EMAIL_LOCAL.test(text[local - 1])) local -= 1;
    const literal = addressLiteralEnd(text, at);
    if (literal !== -1 && local < at) {
      redacted += `${text.slice(cursor, local)}[redacted]`;
      cursor = literal;
      continue;
    }
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
  if (text.length === 0 || /[\s"&|<>^%()]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** A Windows npm shim is codex.cmd. cmd.exe can start it; spawn cannot. */
export function appServerLaunch(bin, args = [], platform = process.platform) {
  if (platform !== "win32") return { command: bin, args, verbatim: false };
  const literalBin = String(bin).includes("%");
  const commandBin = literalBin ? "%AFTER_HOURS_CODEX_BIN%" : bin;
  const commandLine = [commandBin, ...args].map(quoteCmd).join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    verbatim: true,
    ...(literalBin ? { env: { AFTER_HOURS_CODEX_BIN: String(bin) } } : {}),
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
    ...(launch.env ? { env: { ...process.env, ...launch.env } } : {}),
  });
  const stderrState = { safe: "", pending: "" };
  let failure = null;
  const pending = new Map();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    retainStderr(stderrState, chunk);
  });
  child.stderr.on("error", () => {});

  let failurePlaceholder = false;
  const rejectPending = (error, { replace = false, placeholder = false } = {}) => {
    if (failure && !(replace && failurePlaceholder)) return;
    failure = error;
    failurePlaceholder = placeholder;
    if (placeholder) return;
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      pending.delete(id);
      waiter.reject(error);
    }
  };

  bindStdin(child.stdin, rejectPending);

  let stopping = false;
  let outputTimer = null;
  child.on("error", (error) => {
    const reason = error.code || redactDiagnostic(error.message);
    rejectPending(new Error(`codex app-server failed to start: ${reason}`));
  });
  child.on("exit", (code, signal) => {
    if (outputTimer) clearTimeout(outputTimer);
    const why = signal ? `signal ${signal}` : `code ${code}`;
    const detail = stderrDetail(stderrText(stderrState));
    rejectPending(
      new Error(
        detail ? `codex app-server exited (${why}): ${detail}` : `codex app-server exited (${why})`,
      ),
      { replace: true },
    );
  });

  let stdoutBuffer = "";
  const rejectOversized = () => {
    stdoutBuffer = "";
    rejectPending(new Error("codex app-server output line exceeded the limit"));
    if (!stopping) stopChild(child);
  };
  const takeStdoutLine = (line) => {
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
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (failure) return;
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline === -1) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.length > STDERR_LINE_LIMIT) {
        rejectOversized();
        return;
      }
      takeStdoutLine(line);
    }
    if (stdoutBuffer.length > STDERR_LINE_LIMIT) rejectOversized();
  });
  child.stdout.on("error", () => {});
  child.stdout.on("end", () => {
    if (stopping || failure) return;
    if (child.exitCode != null || child.signalCode != null) return;
    outputTimer = setTimeout(() => {
      outputTimer = null;
      if (stopping || failure) return;
      if (child.exitCode != null || child.signalCode != null) return;
      const detail = stderrDetail(stderrText(stderrState));
      const error = new Error(
        detail ? `codex app-server output closed: ${detail}` : "codex app-server output closed",
      );
      rejectPending(error, { placeholder: true });
      outputTimer = setTimeout(() => {
        outputTimer = null;
        if (!failurePlaceholder) return;
        rejectPending(error, { replace: true });
      }, 1000);
    }, 150);
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
    stopping = true;
    if (outputTimer) clearTimeout(outputTimer);
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

/** Name only the extra kinds that were actually merged into the summary. */
function threadScope(sources) {
  const extras = EXTRA_SOURCE_KINDS.filter((kind) => sources?.[kind]);
  return extras.length > 0 ? `interactive+${extras.join("+")}` : "interactive";
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

    const rateLimitsParams = { excludeResetCreditDetails: true };
    const active = await listThreads(client, { pages, limit, archived: false, idBase: 2 });
    if (active.error) {
      const limits = await client.request(100, "account/rateLimits/read", rateLimitsParams);
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

    const counted = summarizeThreads(
      dedupeThreads([
        ...active.threads,
        ...(extra.error ? [] : extra.threads),
        ...(archived.error ? [] : archived.threads),
        ...(archivedExtra.error ? [] : archivedExtra.threads),
      ]),
    );
    const limits = await client.request(100, "account/rateLimits/read", rateLimitsParams);
    return {
      userAgent: shareableUserAgent(init.result?.userAgent),
      threads: {
        ...counted,
        more:
          active.more ||
          (!extra.error && extra.more) ||
          (!archived.error && archived.more) ||
          (!archivedExtra.error && archivedExtra.more),
        scope: threadScope(counted.sources),
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
