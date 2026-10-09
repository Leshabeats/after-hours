import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCodexEvent,
  buildDelivery,
  createSession,
  deliveryForWire,
  eventFromNotification,
  interruptSession,
  limitFromRateLimits,
} from "./session.ts";
import type { LimitSnapshot } from "./types.ts";

const THREAD = "11111111-1111-4111-8111-111111111111";
const TURN = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";

function last(input = 10, output = 2) {
  return {
    inputTokens: input,
    cachedInputTokens: 4,
    outputTokens: output,
    reasoningOutputTokens: 0,
    totalTokens: input + output,
  };
}

function session() {
  return createSession({
    threadId: THREAD,
    missionId: "vitejs/vite#1",
    isPr: false,
    model: "gpt-6-astra",
  });
}

const report = `Итог
\`\`\`json
{
  "schemaVersion": 1,
  "findings": "Уже исправлено",
  "work": "Сверил обсуждение и код.",
  "evidence": ["Тест на main зелёный."],
  "unknowns": ["Нет Windows."],
  "nextSteps": ["Спросить автора."],
  "links": [{ "url": "https://github.com/vitejs/vite/issues/1", "kind": "issue" }],
  "inputTokens": 99999
}
\`\`\``;

describe("research session", () => {
  it("keeps the latest last for one turn and ignores total, children, and prose counts", () => {
    const first = eventFromNotification(
      {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: THREAD,
          turnId: TURN,
          tokenUsage: { last: last(10, 2), total: last(1000, 50) },
        },
      },
      THREAD,
    );
    const second = eventFromNotification(
      {
        method: "thread/tokenUsage/updated",
        params: { threadId: THREAD, turnId: TURN, tokenUsage: { last: last(12, 3), total: last(5000, 9) } },
      },
      THREAD,
    );
    const child = eventFromNotification(
      {
        method: "thread/tokenUsage/updated",
        params: { threadId: CHILD, turnId: "44444444-4444-4444-8444-444444444444", tokenUsage: { last: last(80, 8) } },
      },
      THREAD,
    );
    assert.equal(child, null);
    let current = session();
    current = applyCodexEvent(current, first!);
    current = applyCodexEvent(current, second!);
    current = applyCodexEvent(current, { type: "model", model: "other-model" });
    current = applyCodexEvent(current, {
      type: "turn",
      threadId: THREAD,
      turnId: TURN,
      status: "completed",
      text: `В ответе написано inputTokens 99999.\n${report}`,
    });
    const body = deliveryForWire(current);
    assert.ok(body?.turns);
    assert.equal(body.model, "other-model");
    assert.equal(body.turns.length, 1);
    assert.equal(body.turns[0]?.usage?.inputTokens, 12);
    assert.equal(body.turns[0]?.usage?.cachedInputTokens, 4);
    assert.equal(body.turns[0]?.usage?.totalTokens, 15);
    assert.equal(body?.status, "completed");
    assert.equal(body?.report?.findings, "Уже исправлено");
    assert.equal(JSON.stringify(body).includes("99999"), false);
    assert.equal(JSON.stringify(body).includes("5000"), false);
  });

  it("does not publish waiting or interrupted, and keeps known spend", () => {
    let current = session();
    current = applyCodexEvent(current, {
      type: "usage",
      threadId: THREAD,
      turnId: TURN,
      last: last(7, 1),
    });
    current = applyCodexEvent(current, {
      type: "thread-status",
      threadId: THREAD,
      status: { type: "active", activeFlags: ["waitingOnUserInput"] },
    });
    current = applyCodexEvent(current, {
      type: "turn",
      threadId: THREAD,
      turnId: TURN,
      status: "completed",
      text: report,
    });
    const waiting = buildDelivery(current);
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.report, undefined);
    assert.ok(waiting.turns);
    assert.equal(waiting.turns[0]?.usage?.inputTokens, 7);

    const interrupted = buildDelivery(
      interruptSession(
        applyCodexEvent(session(), {
          type: "usage",
          threadId: THREAD,
          turnId: TURN,
          last: last(7, 1),
        }),
      ),
    );
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.report, undefined);
    assert.ok(interrupted.turns);
    assert.equal(interrupted.turns[0]?.status, "interrupted");
    assert.equal(interrupted.turns[0]?.usage?.inputTokens, 7);
  });

  it("does not publish a parsed report when the stop happens during a wait", () => {
    let current = session();
    current = applyCodexEvent(current, {
      type: "usage",
      threadId: THREAD,
      turnId: TURN,
      last: last(7, 1),
    });
    current = applyCodexEvent(current, {
      type: "turn",
      threadId: THREAD,
      turnId: TURN,
      status: "completed",
      text: report,
    });
    current = applyCodexEvent(current, {
      type: "thread-status",
      threadId: THREAD,
      status: { type: "active", activeFlags: ["waitingOnUserInput"] },
    });
    const stopped = buildDelivery(interruptSession(current));
    assert.equal(stopped.status, "interrupted");
    assert.equal(stopped.report, undefined);
    assert.ok(stopped.turns);
    assert.equal(stopped.turns[0]?.status, "interrupted");
    assert.equal(stopped.turns[0]?.usage?.inputTokens, 7);

    const finished = buildDelivery(
      interruptSession(
        applyCodexEvent(session(), {
          type: "turn",
          threadId: THREAD,
          turnId: TURN,
          status: "completed",
          text: report,
        }),
      ),
    );
    assert.equal(finished.status, "completed");
    assert.equal(finished.report?.findings, "Уже исправлено");
  });

  it("sends failed instead of completed when the answer has no report", () => {
    const current = applyCodexEvent(session(), {
      type: "turn",
      threadId: THREAD,
      turnId: TURN,
      status: "completed",
      text: "Готово, без json. inputTokens 99999",
    });
    const body = buildDelivery(current);
    assert.equal(body.status, "failed");
    assert.equal(body.report, undefined);
    assert.ok(body.turns);
    assert.equal(body.turns[0]?.status, "completed");
  });

  it("maps a rate limit without the plan, account id, or raw amounts", () => {
    const limit = limitFromRateLimits(
      {
        accountId: "acct_secret",
        rateLimits: {
          planType: "pro",
          primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1_700_000_000 },
          secondary: null,
          spendControlReached: false,
          individualLimit: { remainingPercent: 40, limit: "100", used: "60", resetsAt: 1 },
        },
      },
      1_700_000_000_000,
    );
    const text = JSON.stringify(limit);
    assert.equal(text.includes("acct_secret"), false);
    assert.equal(text.includes("pro"), false);
    assert.equal(text.includes("\"100\""), false);
    assert.equal(text.includes("\"60\""), false);
    assert.equal(limit?.primary?.usedPercent, 12);
    assert.equal(limit?.primary?.resetsAt, 1_700_000_000);
    assert.equal(limit?.individualRemainingPercent, 40);
    assert.equal(limit?.secondary, null);
  });

  it("drops a limit the server would reject and still keeps the report", () => {
    let current = applyCodexEvent(session(), {
      type: "turn",
      threadId: THREAD,
      turnId: TURN,
      status: "completed",
      text: report,
    });
    current = {
      ...current,
      limit: { readAt: -1 } as LimitSnapshot,
    };
    const body = deliveryForWire(current);
    assert.equal(body?.status, "completed");
    assert.equal(body?.report?.findings, "Уже исправлено");
    assert.equal(body?.limit, undefined);
  });
});
