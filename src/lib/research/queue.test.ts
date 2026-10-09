import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { handleResearchPost } from "./http.ts";
import { enqueue, flushQueue, readQueue, writeQueue, type QueuePostResult } from "./queue.ts";
import { createMemoryResearch } from "./store.ts";

const NOW = 1_700_000_000_000;
const THREAD = "11111111-1111-4111-8111-111111111111";
const OTHER = "55555555-5555-4555-8555-555555555555";

function report(findings = "Уже исправлено") {
  return {
    schemaVersion: 1,
    findings,
    work: "Сверил код.",
    evidence: ["Тест зелёный."],
    unknowns: ["Нет Windows."],
    nextSteps: ["Спросить автора."],
    links: [{ url: "https://github.com/vitejs/vite/issues/1", kind: "issue" }],
  };
}

function body(threadId: string, findings = "Уже исправлено") {
  return {
    threadId,
    missionId: "vitejs/vite#1",
    isPr: false,
    status: "completed",
    model: "gpt-6-astra",
    report: report(findings),
    turns: [
      {
        turnId: "22222222-2222-4222-8222-222222222222",
        status: "completed",
        usage: {
          inputTokens: 12,
          cachedInputTokens: 4,
          outputTokens: 3,
          reasoningOutputTokens: 0,
          totalTokens: 15,
        },
      },
    ],
  };
}

function request(token: string, payload: unknown) {
  return new Request("http://127.0.0.1/api/research", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

describe("research delivery queue", () => {
  it("survives a failed post and a reload without a second spend row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-queue-"));
    const path = join(dir, "queue.json");
    const repo = createMemoryResearch();
    const token = repo.createGrant("owner", NOW).token;
    let fail = true;
    const post = async (payload: unknown): Promise<QueuePostResult> => {
      if (fail) throw new Error("offline");
      const response = await handleResearchPost(request(token, payload), repo, NOW);
      return { ok: response.ok, status: response.status };
    };

    let queue = enqueue(readQueue(path), THREAD, body(THREAD));
    writeQueue(path, queue);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const offline = await flushQueue(readQueue(path), post, (next) => writeQueue(path, next));
    assert.equal(offline.stopped, "network");
    assert.equal(readQueue(path).pending[THREAD] != null, true);

    fail = false;
    const delivered = await flushQueue(readQueue(path), post, (next) => writeQueue(path, next));
    assert.equal(delivered.stopped, null);
    assert.deepEqual(readQueue(path).pending, {});
    const again = await flushQueue(readQueue(path), post);
    assert.equal(again.stopped, null);
    const run = repo.readRun("owner", THREAD);
    assert.equal(run?.turns.length, 1);
    assert.equal(run?.turns[0]?.usage.inputTokens, 12);
    assert.equal(run?.publishedAt, NOW);
    queue = readQueue(path);
    assert.equal(Object.keys(queue.pending).length, 0);
  });

  it("parks a conflicting completion and stops the rest of the pass on 401", async () => {
    const repo = createMemoryResearch();
    const token = repo.createGrant("owner", NOW).token;
    await handleResearchPost(request(token, body(THREAD)), repo, NOW);
    let posts = 0;
    const post = async (payload: unknown): Promise<QueuePostResult> => {
      posts += 1;
      const record = payload as { threadId?: string };
      if (record.threadId === OTHER) return { ok: false, status: 401 };
      const response = await handleResearchPost(request(token, payload), repo, NOW + 1);
      return { ok: response.ok, status: response.status };
    };
    const queued = enqueue(
      enqueue({ pending: {}, blocked: {} }, THREAD, body(THREAD, "Другой вывод")),
      OTHER,
      body(OTHER),
    );
    const flushed = await flushQueue(queued, post);
    assert.equal(flushed.stopped, "unauthorized");
    assert.equal(flushed.queue.blocked[THREAD]?.status, 409);
    assert.equal(flushed.queue.pending[OTHER] != null, true);
    assert.equal(repo.readRun("owner", THREAD)?.report?.findings, "Уже исправлено");
    assert.equal(repo.readRun("owner", OTHER), null);
    const parked = await flushQueue(flushed.queue, post);
    assert.equal(parked.stopped, "unauthorized");
    assert.equal(posts, 3);
  });
});
