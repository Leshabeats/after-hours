import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultAgentPrompt } from "../src/lib/agent-prompt.ts";
import { missionId, parseGithubRef } from "../src/lib/kinds.ts";
import { enqueue, flushQueue, readQueue, writeQueue } from "../src/lib/research/queue.ts";
import {
  applyCodexEvent,
  createSession,
  deliveryForWire,
  eventFromNotification,
  interruptSession,
  limitFromRateLimits,
} from "../src/lib/research/session.ts";
import { appServerLaunch, appServerSpawnOptions, formatFailure } from "./codex-app-server-probe.mjs";

export const STDOUT_LINE_LIMIT = 8_000_000;
const TERMINAL = new Set(["completed", "interrupted", "failed"]);
const HELP = `after-hours research connector

  node --experimental-strip-types scripts/research-connector.mjs \\
    --origin http://127.0.0.1:5173 \\
    --token-file ~/.after-hours-token \\
    --mission vitejs/vite#123 \\
    --queue ~/.after-hours/research-queue.json

  --flush-only delivers the queue and does not start Codex.
  Supported Codex is codex-cli 0.159.x. Revoke the grant on /log to disconnect.
`;

export function isSupportedCodexVersion(text) {
  const match = /(\d+\.\d+\.\d+)/.exec(String(text ?? ""));
  return match != null && match[1].startsWith("0.159.");
}

export function serverRequestReply(method) {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    return { result: { decision: "decline" } };
  }
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { result: { decision: "abort" } };
  }
  if (method === "mcpServer/elicitation/request") return { result: { action: "decline" } };
  return { error: { code: -32601, message: "method not supported" } };
}

export function parseArgs(argv) {
  const options = {
    origin: null,
    tokenFile: null,
    mission: null,
    queuePath: null,
    flushOnly: false,
    bin: process.env.CODEX_BIN || "codex",
    cwd: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[(index += 1)];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--flush-only") options.flushOnly = true;
    else if (arg === "--origin") options.origin = value();
    else if (arg === "--token-file") options.tokenFile = value();
    else if (arg === "--mission") options.mission = value();
    else if (arg === "--queue") options.queuePath = value();
    else if (arg === "--codex") options.bin = value();
    else if (arg === "--cwd") options.cwd = value();
    else throw new Error(`unknown argument ${arg}`);
  }
  if (options.help) return options;
  if (!options.origin || !options.tokenFile || !options.queuePath) {
    throw new Error("--origin, --token-file, and --queue are required");
  }
  if (!options.flushOnly && !options.mission) {
    throw new Error("--mission is required unless --flush-only");
  }
  return options;
}

export function pushStdout(buffer, chunk, limit = STDOUT_LINE_LIMIT) {
  let next = buffer + chunk;
  const lines = [];
  for (;;) {
    const newline = next.indexOf("\n");
    if (newline === -1) break;
    const line = next.slice(0, newline);
    next = next.slice(newline + 1);
    if (line.length > limit) return { buffer: "", overflow: true, lines };
    lines.push(line);
  }
  if (next.length > limit) return { buffer: "", overflow: true, lines };
  return { buffer: next, overflow: false, lines };
}

/** A server request is answered here and is not treated as our own RPC result. */
export function handleProtocolMessage(message, { pending, onNotification, send }) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  if (typeof message.method === "string") {
    if (message.id != null) send({ id: message.id, ...serverRequestReply(message.method) });
    onNotification?.(message);
    return;
  }
  if (message.id == null || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  waiter.resolve(message);
}

export async function fetchPublicMission(ref, fetchImpl = fetch) {
  const parsed = parseGithubRef(ref);
  if (!parsed || parsed.number < 1) throw new Error("mission must look like owner/repo#123");
  const response = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues/${parsed.number}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "after-hours-connector",
      },
    },
  );
  if (!response.ok) throw new Error(`github status ${response.status}`);
  const body = await response.json();
  const isPr = body.pull_request != null;
  return {
    id: missionId(parsed.owner, parsed.repo, parsed.number),
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    title: typeof body.title === "string" ? body.title : "",
    body: typeof body.body === "string" ? body.body : "",
    url:
      typeof body.html_url === "string"
        ? body.html_url
        : `https://github.com/${parsed.owner}/${parsed.repo}/${isPr ? "pull" : "issues"}/${parsed.number}`,
    isPr,
  };
}

export async function postResearch(origin, token, body, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(new URL("/api/research", origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function runConnector(options, deps) {
  let queue = readQueue(options.queuePath);
  const flushed = await flushQueue(queue, deps.post, (next) => {
    queue = next;
    writeQueue(options.queuePath, next);
  });
  queue = flushed.queue;
  if (options.flushOnly || flushed.stopped === "unauthorized") {
    return { started: false, stopped: flushed.stopped, delivery: null };
  }

  const mission = await deps.fetchMission(options.mission);
  const client = await deps.connect();
  const onAbort = () => {
    void client.stop?.();
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  let session = null;
  let failure = null;
  const persist = () => {
    if (!session) return;
    const body = deliveryForWire(session);
    if (!body) return;
    queue = enqueue(queue, session.threadId, body);
    writeQueue(options.queuePath, queue);
  };

  try {
    try {
      const thread = await client.startThread({ cwd: options.cwd });
      session = createSession({
        threadId: thread.threadId,
        missionId: mission.id,
        isPr: mission.isPr,
        model: thread.model ?? null,
      });
      persist();
      await client.runTurn({
        threadId: thread.threadId,
        prompt: defaultAgentPrompt(mission),
        cwd: options.cwd,
        onNotification(message) {
          const event = eventFromNotification(message, session.threadId);
          if (!event) return;
          session = applyCodexEvent(session, event);
          persist();
        },
      });
      if (client.readLimit) {
        try {
          const limit = await client.readLimit();
          if (limit) {
            session = applyCodexEvent(session, { type: "limit", limit });
            persist();
          }
        } catch {
          // A missing limit does not drop the report.
        }
      }
    } catch (error) {
      if (options.signal?.aborted && session) {
        session = interruptSession(session);
        persist();
      } else {
        failure = error;
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    await client.stop?.();
  }

  const again = await flushQueue(queue, deps.post, (next) => {
    queue = next;
    writeQueue(options.queuePath, next);
  });
  if (failure) throw failure;
  return {
    started: true,
    stopped: again.stopped,
    delivery: session ? deliveryForWire(session) : null,
  };
}

function stopChild(child) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        child.kill("SIGTERM");
      } catch {
        // The process is already gone.
      }
    }
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The process is already gone.
    }
  }, 1000);
  timer.unref();
  child.once("exit", () => clearTimeout(timer));
}

export function createCodexClient(bin = "codex") {
  const launch = appServerLaunch(bin, ["app-server", "--listen", "stdio://"]);
  const child = spawn(launch.command, launch.args, appServerSpawnOptions(launch));
  const pending = new Map();
  let nextId = 1;
  let listener = () => {};
  let terminalMessage = null;
  let terminalWait = null;
  let buffer = "";
  let stderrTail = "";

  const rejectAll = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    if (terminalWait) {
      const waiter = terminalWait;
      terminalWait = null;
      waiter.reject(error);
    }
  };

  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const accept = (message) => {
    const status = message?.params?.turn?.status;
    if (message?.method === "turn/completed" && TERMINAL.has(status)) terminalMessage = message;
    handleProtocolMessage(message, {
      pending,
      onNotification: (notice) => listener(notice),
      send,
    });
    if (terminalWait && terminalMessage) {
      const waiter = terminalWait;
      terminalWait = null;
      waiter.resolve(terminalMessage);
    }
  };

  const request = (method, params, timeoutMs = 20_000) => {
    const id = `c${nextId}`;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error(`codex app-server timed out on ${method}`));
            }, timeoutMs)
          : null;
      pending.set(id, {
        resolve: (message) => {
          if (timer) clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          reject(error);
        },
      });
      try {
        send({ id, method, params });
      } catch (error) {
        pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  };

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-2000);
  });
  child.stderr.on("error", () => {});
  child.stdin.on("error", () => {});
  child.on("error", (error) => {
    rejectAll(new Error(`codex app-server failed to start: ${error.code || "error"}`));
  });
  child.on("exit", (code, signal) => {
    const why = signal ? `signal ${signal}` : `code ${code}`;
    const detail = stderrTail ? `: ${formatFailure(new Error(stderrTail))}` : "";
    rejectAll(new Error(`codex app-server exited (${why})${detail}`));
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const pushed = pushStdout(buffer, chunk);
    buffer = pushed.buffer;
    if (pushed.overflow) {
      buffer = "";
      stopChild(child);
      rejectAll(new Error("codex app-server output line exceeded the limit"));
      return;
    }
    for (const line of pushed.lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        accept(JSON.parse(trimmed));
      } catch {
        // Ignore a non-JSON stdout line.
      }
    }
  });

  return {
    async startThread({ cwd }) {
      const init = await request("initialize", {
        clientInfo: {
          name: "after-hours-connector",
          title: "After Hours connector",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: false },
      });
      if (init.error) throw new Error(init.error.message || "initialize failed");
      send({ method: "initialized" });
      const started = await request("thread/start", {
        cwd,
        approvalPolicy: "on-request",
        sandbox: "read-only",
        ephemeral: true,
      });
      if (started.error) throw new Error(started.error.message || "thread/start failed");
      const threadId = started.result?.thread?.id;
      if (typeof threadId !== "string") throw new Error("thread/start returned no thread id");
      const model = typeof started.result?.model === "string" ? started.result.model : null;
      return { threadId, model };
    },
    async runTurn({ threadId, prompt, cwd, onNotification }) {
      listener = onNotification;
      terminalMessage = null;
      const response = await request(
        "turn/start",
        {
          threadId,
          cwd,
          effort: "low",
          input: [{ type: "text", text: prompt }],
        },
        0,
      );
      if (response.error) throw new Error(response.error.message || "turn/start failed");
      const turn = response.result?.turn;
      if (turn) listener({ method: "turn/started", params: { threadId, turn } });
      if (turn && TERMINAL.has(turn.status)) {
        listener({ method: "turn/completed", params: { threadId, turn } });
        return;
      }
      if (terminalMessage) return;
      await new Promise((resolve, reject) => {
        terminalWait = { resolve, reject };
        if (terminalMessage) {
          terminalWait = null;
          resolve(terminalMessage);
        }
      });
    },
    async readLimit() {
      const response = await request("account/rateLimits/read", { excludeResetCreditDetails: true });
      if (response.error) return null;
      return limitFromRateLimits(response.result, Date.now());
    },
    async stop() {
      stopChild(child);
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const token = readFileSync(options.tokenFile, "utf8").trim();
  if (!token.startsWith("ahc_")) throw new Error("token file does not look like a connector grant");
  const origin = new URL(options.origin);
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("--origin must be http or https");
  }
  if (!options.flushOnly) {
    const version = execFileSync(options.bin, ["--version"], { encoding: "utf8" });
    if (!isSupportedCodexVersion(version)) {
      console.error(
        "Проверенная версия codex-cli — 0.159.x. Этот бинарник выглядит иначе, запуск продолжается.",
      );
    }
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), "after-hours-research-"));
  const result = await runConnector(
    { ...options, cwd, signal: controller.signal },
    {
      post: (body) => postResearch(origin.origin, token, body),
      fetchMission: (ref) => fetchPublicMission(ref),
      connect: () => createCodexClient(options.bin),
    },
  );
  const status = result.delivery?.status ?? (result.stopped ? result.stopped : "flushed");
  console.log(status);
  if (result.stopped) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatFailure(error));
    process.exitCode = 1;
  });
}
