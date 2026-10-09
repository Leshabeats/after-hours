import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleResearchPost } from "./http.ts";
import { researchDeliverySchema } from "./schema.ts";
import { createMemoryResearch } from "./store.ts";

const NOW = 1_700_000_000_000;

const report = {
  schemaVersion: 1 as const,
  findings: "Уже исправлено",
  work: "Сверил код и обсуждение.",
  evidence: ["Тест не падает на main."],
  unknowns: ["Нет Windows."],
  nextSteps: ["Спросить автора."],
  links: [{ url: "https://github.com/vitejs/vite/issues/1", kind: "issue" }],
};

function body(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread_abc12345",
    missionId: "vitejs/vite#1",
    isPr: false,
    status: "in_progress",
    model: "gpt-6-astra",
    turns: [] as unknown[],
    ...overrides,
  };
}

function request(token: string | null, payload: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("http://127.0.0.1/api/research", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

describe("research delivery http", () => {
  it("ignores a client user id and keeps the limit out of the response", async () => {
    const repo = createMemoryResearch();
    const { token } = repo.createGrant("owner", NOW);
    const parsed = researchDeliverySchema.parse({
      ...body(),
      userId: "attacker",
      plan: "secret-plan",
    });
    assert.equal("userId" in parsed, false);
    assert.equal("plan" in parsed, false);

    const response = await handleResearchPost(
      request(token, {
        ...body(),
        userId: "attacker",
        limit: {
          readAt: NOW,
          primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: NOW + 10 },
          secondary: null,
          spendControlReached: null,
          individualRemainingPercent: null,
        },
      }),
      repo,
      NOW,
    );
    const payload = (await response.json()) as {
      ok: boolean;
      run: { userId?: string; publishedAt: number | null; status: string };
    };
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.run.userId, undefined);
    assert.equal(payload.run.publishedAt, null);
    assert.equal(payload.run.status, "in_progress");
    const text = JSON.stringify(payload);
    assert.equal(text.includes("usedPercent"), false);
    assert.equal(text.includes("attacker"), false);
    assert.equal(text.includes(token), false);
    assert.equal(repo.readRun("owner", "thread_abc12345")?.userId, "owner");
    assert.equal(repo.readRun("attacker", "thread_abc12345"), null);
    assert.equal(repo.readLimit("owner")?.primary?.usedPercent, 12);
    assert.equal(repo.readLimit("owner")?.spendControlReached, null);
  });

  it("rejects a missing grant, a revoked grant, a bad report, and a duplicate turn", async () => {
    const repo = createMemoryResearch();
    const { token, grant } = repo.createGrant("owner", NOW);
    const missing = await handleResearchPost(request(null, body()), repo, NOW);
    assert.equal(missing.status, 401);

    repo.revokeGrant("owner", grant.id, NOW);
    const revoked = await handleResearchPost(request(token, body()), repo, NOW);
    assert.equal(revoked.status, 401);
    assert.equal(repo.readRun("owner", "thread_abc12345"), null);

    const fresh = repo.createGrant("owner", NOW + 1).token;
    const broken = await handleResearchPost(
      request(fresh, body({ status: "completed", report: { ...report, findings: " " } })),
      repo,
      NOW,
    );
    assert.equal(broken.status, 400);
    assert.equal(repo.readRun("owner", "thread_abc12345"), null);

    const duplicated = await handleResearchPost(
      request(
        fresh,
        body({
          turns: [
            { turnId: "turn_same0001", status: "completed", usage: null },
            { turnId: "turn_same0001", status: "completed", usage: null },
          ],
        }),
      ),
      repo,
      NOW,
    );
    assert.equal(duplicated.status, 400);
    assert.equal(repo.readRun("owner", "thread_abc12345"), null);
  });

  it("replays the same completion and refuses another user's thread", async () => {
    const repo = createMemoryResearch();
    const owner = repo.createGrant("owner", NOW).token;
    const other = repo.createGrant("other", NOW).token;
    const first = await handleResearchPost(
      request(owner, body({ status: "completed", report, turns: [
        {
          turnId: "turn_done0001",
          status: "completed",
          usage: {
            inputTokens: 100,
            cachedInputTokens: 40,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 110,
          },
        },
      ] })),
      repo,
      NOW,
    );
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { run: { publishedAt: number | null } };
    assert.equal(firstBody.run.publishedAt, NOW);
    const replay = await handleResearchPost(
      request(owner, body({ status: "completed", report, turns: [
        {
          turnId: "turn_done0001",
          status: "completed",
          usage: {
            inputTokens: 100,
            cachedInputTokens: 40,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 110,
          },
        },
      ] })),
      repo,
      NOW + 5,
    );
    const replayBody = (await replay.json()) as {
      replay: boolean;
      run: { turns: unknown[]; publishedAt: number | null };
    };
    assert.equal(replay.status, 200);
    assert.equal(replayBody.replay, true);
    assert.equal(replayBody.run.turns.length, 1);
    assert.equal(replayBody.run.publishedAt, NOW);

    const stolen = await handleResearchPost(
      request(other, body({ status: "failed" })),
      repo,
      NOW + 6,
    );
    assert.equal(stolen.status, 403);
    assert.equal(repo.readRun("owner", "thread_abc12345")?.status, "completed");
    assert.equal(repo.readRun("other", "thread_abc12345"), null);
  });
});
