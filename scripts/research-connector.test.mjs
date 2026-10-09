import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assertProbeMethod } from "./codex-app-server-probe.mjs";
import {
  applyCodexEvent,
  createSession,
  deliveryForWire,
  eventFromNotification,
} from "../src/lib/research/session.ts";
import {
  applyTurnStartResult,
  connectorStatus,
  fetchPublicMission,
  handleProtocolMessage,
  isSupportedCodexVersion,
  parseArgs,
  postResearch,
  pushStdout,
  runConnector,
  serverRequestReply,
} from "./research-connector.mjs";

const THREAD = "11111111-1111-4111-8111-111111111111";
const TURN = "22222222-2222-4222-8222-222222222222";
const QUEUED = "55555555-5555-4555-8555-555555555555";

function queuePath() {
  return join(mkdtempSync(join(tmpdir(), "ah-connector-")), "queue.json");
}

function last(input = 12) {
  return {
    inputTokens: input,
    cachedInputTokens: 4,
    outputTokens: 3,
    reasoningOutputTokens: 0,
    totalTokens: input + 3,
  };
}

const reportText = `\`\`\`json
{"schemaVersion":1,"findings":"Уже исправлено","work":"Сверил код.","evidence":["Тест зелёный."],"unknowns":["Нет Windows."],"nextSteps":["Спросить автора."],"links":[{"url":"https://github.com/vitejs/vite/issues/1","kind":"issue"}],"inputTokens":99999}
\`\`\``;

function mission() {
  return {
    id: "vitejs/vite#1",
    owner: "vitejs",
    repo: "vite",
    number: 1,
    title: "Night",
    body: "Steps",
    url: "https://github.com/vitejs/vite/issues/1",
    isPr: false,
  };
}

describe("research connector", () => {
  it("keeps the probe from starting a thread", () => {
    assert.throws(() => assertProbeMethod("thread/start"), /probe refuses thread\/start/);
    assert.throws(() => assertProbeMethod("turn/start"), /probe refuses turn\/start/);
  });

  it("declines command approval and does not treat a server request as the RPC result", () => {
    const reply = serverRequestReply("item/commandExecution/requestApproval");
    assert.equal(reply.result.decision, "decline");
    assert.equal(JSON.stringify(serverRequestReply("item/fileChange/requestApproval")).includes("accept"), false);
    assert.equal(serverRequestReply("item/permissions/requestApproval").error.code, -32601);

    let sent = null;
    let noticed = 0;
    const pending = new Map([["c1", { resolve: () => { throw new Error("server request resolved the client call"); } }]]);
    handleProtocolMessage(
      { id: "c1", method: "item/commandExecution/requestApproval", params: { command: "rm -rf /" } },
      {
        pending,
        onNotification: () => {
          noticed += 1;
        },
        send: (message) => {
          sent = message;
        },
      },
    );
    assert.equal(sent.result.decision, "decline");
    assert.equal(pending.has("c1"), true);
    assert.equal(noticed, 1);

    const split = pushStdout('{"method":', '"initialized"}\n{"id":');
    assert.equal(split.overflow, false);
    assert.equal(split.lines.length, 1);
    assert.equal(split.lines[0], '{"method":"initialized"}');
    assert.equal(split.buffer, '{"id":');
  });

  it("recognises codex-cli 0.159 and parses the public mission without a token", async () => {
    assert.equal(isSupportedCodexVersion("codex-cli 0.159.0"), true);
    assert.equal(isSupportedCodexVersion("codex-cli 0.159.2"), true);
    assert.equal(isSupportedCodexVersion("codex-cli 0.160.0"), false);
    const options = parseArgs([
      "--origin",
      "http://127.0.0.1:5173",
      "--token-file",
      "token",
      "--queue",
      "queue.json",
      "--flush-only",
    ]);
    assert.equal(options.flushOnly, true);
    assert.throws(() => parseArgs(["--origin", "http://127.0.0.1:5173", "--token-file", "token", "--queue", "queue.json"]));

    let authorization;
    const loaded = await fetchPublicMission("vitejs/vite#5", async (url, init) => {
      authorization = init.headers.authorization;
      assert.match(String(url), /\/repos\/vitejs\/vite\/issues\/5$/);
      return {
        ok: true,
        async json() {
          return { title: "PR", body: "Body", html_url: "https://github.com/vitejs/vite/pull/5", pull_request: {} };
        },
      };
    });
    assert.equal(authorization, undefined);
    assert.equal(loaded.isPr, true);
    await assert.rejects(
      () => fetchPublicMission("vitejs/vite#5", async () => ({ ok: false, status: 404 })),
      /github status 404/,
    );
  });

  it("does not start Codex when GitHub or the grant fails", async () => {
    const path = queuePath();
    let connected = false;
    await assert.rejects(
      () =>
        runConnector(
          { queuePath: path, mission: "vitejs/vite#1", cwd: "/tmp", flushOnly: false },
          {
            post: async () => ({ ok: true, status: 200 }),
            fetchMission: async () => {
              throw new Error("github status 404");
            },
            connect: async () => {
              connected = true;
              throw new Error("should not connect");
            },
          },
        ),
      /github status 404/,
    );
    assert.equal(connected, false);

    const { writeQueue, enqueue } = await import("../src/lib/research/queue.ts");
    writeQueue(path, enqueue({ pending: {}, blocked: {} }, QUEUED, { threadId: QUEUED }));
    connected = false;
    const blocked = await runConnector(
      { queuePath: path, mission: "vitejs/vite#1", cwd: "/tmp", flushOnly: false },
      {
        post: async () => ({ ok: false, status: 401 }),
        fetchMission: async () => mission(),
        connect: async () => {
          connected = true;
          throw new Error("should not connect");
        },
      },
    );
    assert.equal(blocked.started, false);
    assert.equal(blocked.stopped, "unauthorized");
    assert.equal(connected, false);
  });

  it("posts one snapshot after a network miss and does not double the turn", async () => {
    const path = queuePath();
    const { writeQueue, enqueue, readQueue } = await import("../src/lib/research/queue.ts");
    writeQueue(path, enqueue({ pending: {}, blocked: {} }, QUEUED, { threadId: QUEUED, missionId: "vitejs/vite#9" }));
    const posts = [];
    let offline = true;
    let connected = 0;
    const result = await runConnector(
      { queuePath: path, mission: "vitejs/vite#1", cwd: "/tmp", flushOnly: false },
      {
        post: async (body) => {
          if (offline) {
            offline = false;
            throw new Error("offline");
          }
          posts.push(body);
          return { ok: true, status: 200 };
        },
        fetchMission: async () => mission(),
        connect: async () => {
          connected += 1;
          return {
            async startThread() {
              return { threadId: THREAD, model: "gpt-6-astra" };
            },
            async runTurn({ onNotification }) {
              onNotification({
                method: "thread/tokenUsage/updated",
                params: { threadId: THREAD, turnId: TURN, tokenUsage: { last: last(10), total: last(90) } },
              });
              onNotification({
                method: "thread/tokenUsage/updated",
                params: {
                  threadId: "33333333-3333-4333-8333-333333333333",
                  turnId: "44444444-4444-4444-8444-444444444444",
                  tokenUsage: { last: last(80) },
                },
              });
              onNotification({
                method: "thread/tokenUsage/updated",
                params: { threadId: THREAD, turnId: TURN, tokenUsage: { last: last(12), total: last(90) } },
              });
              onNotification({
                method: "turn/completed",
                params: {
                  threadId: THREAD,
                  turn: { id: TURN, status: "completed", items: [{ type: "agentMessage", text: reportText }] },
                },
              });
            },
            async readLimit() {
              return null;
            },
            async stop() {},
          };
        },
      },
    );
    assert.equal(connected, 1);
    assert.equal(result.delivery?.status, "completed");
    assert.equal(result.delivery?.turns.length, 1);
    assert.equal(result.delivery?.turns[0].usage.inputTokens, 12);
    assert.equal(JSON.stringify(posts).includes("99999"), false);
    const delivered = posts.find((body) => body.threadId === THREAD);
    assert.equal(delivered.turns.length, 1);
    assert.equal(readQueue(path).pending[THREAD], undefined);
    assert.equal(readQueue(path).pending[QUEUED], undefined);

    const replayPosts = [];
    const replay = await runConnector(
      { queuePath: path, flushOnly: true },
      {
        post: async (body) => {
          replayPosts.push(body);
          return { ok: true, status: 200 };
        },
        fetchMission: async () => {
          throw new Error("should not fetch");
        },
        connect: async () => {
          throw new Error("should not connect");
        },
      },
    );
    assert.equal(replay.started, false);
    assert.equal(replayPosts.length, 0);
  });

  it("keeps known spend when the local process is interrupted", async () => {
    const path = queuePath();
    const posts = [];
    const controller = new AbortController();
    let stopRun = () => {};
    let turnStarted;
    const turnReady = new Promise((resolve) => {
      turnStarted = resolve;
    });
    const run = runConnector(
      { queuePath: path, mission: "vitejs/vite#1", cwd: "/tmp", flushOnly: false, signal: controller.signal },
      {
        post: async (body) => {
          posts.push(body);
          return { ok: true, status: 200 };
        },
        fetchMission: async () => mission(),
        connect: async () => ({
          async startThread() {
            return { threadId: THREAD, model: "gpt-6-astra" };
          },
          async runTurn({ onNotification }) {
            onNotification({
              method: "thread/tokenUsage/updated",
              params: { threadId: THREAD, turnId: TURN, tokenUsage: { last: last(12) } },
            });
            turnStarted();
            await new Promise((_resolve, reject) => {
              stopRun = () => reject(new Error("codex app-server exited"));
            });
          },
          stop() {
            stopRun();
          },
        }),
      },
    );
    let timer;
    const result = await Promise.race([
      run,
      turnReady.then(
        () =>
          new Promise((_resolve, reject) => {
            controller.abort();
            timer = setTimeout(() => {
              stopRun();
              reject(new Error("abort did not stop the client"));
            }, 1000);
          }),
      ),
    ]).finally(() => clearTimeout(timer));
    assert.equal(result.delivery?.status, "interrupted");
    assert.equal(result.delivery?.report, undefined);
    assert.equal(result.delivery?.turns[0].usage.inputTokens, 12);
    assert.equal(posts.at(-1).status, "interrupted");
  });

  it("keeps a completion that arrived before the turn/start result", () => {
    const terminalMessage = {
      method: "turn/completed",
      params: {
        threadId: THREAD,
        turn: { id: TURN, status: "completed", items: [{ type: "agentMessage", text: reportText }] },
      },
    };
    let current = createSession({
      threadId: THREAD,
      missionId: "vitejs/vite#1",
      isPr: false,
      model: null,
    });
    const seen = eventFromNotification(terminalMessage, THREAD);
    assert.ok(seen);
    current = applyCodexEvent(current, seen);
    const methods = [];
    const outcome = applyTurnStartResult({
      threadId: THREAD,
      response: { result: { turn: { id: TURN, status: "inProgress", items: [] } } },
      terminalMessage,
      listener(message) {
        methods.push(message.method);
        const event = eventFromNotification(message, THREAD);
        if (event) current = applyCodexEvent(current, event);
      },
    });
    const body = deliveryForWire(current);
    assert.equal(outcome, "done");
    assert.deepEqual(methods, ["turn/completed"]);
    assert.equal(body?.status, "completed");
    assert.equal(body?.report?.findings, "Уже исправлено");
  });

  it("prints a failed flush instead of the local snapshot", () => {
    assert.equal(
      connectorStatus({ stopped: "network", delivery: { status: "completed" } }),
      "network",
    );
    assert.equal(
      connectorStatus({ stopped: "unauthorized", delivery: { status: "interrupted" } }),
      "unauthorized",
    );
    assert.equal(connectorStatus({ stopped: null, delivery: { status: "completed" } }), "completed");
    assert.equal(connectorStatus({ stopped: null, delivery: null }), "flushed");
  });

  it("does not echo the bearer token from the post result", async () => {
    const token = "ahc_exampletokenvalue";
    let header = null;
    const result = await postResearch("http://127.0.0.1:5173", token, { ok: 1 }, async (_url, init) => {
      header = init.headers.authorization;
      return { ok: true, status: 200 };
    });
    assert.equal(header, `Bearer ${token}`);
    assert.equal(JSON.stringify(result).includes(token), false);
  });
});
