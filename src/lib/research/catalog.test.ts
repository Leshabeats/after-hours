import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportLinkHref, spendLabel } from "./catalog.ts";
import type { TurnSpend } from "./accounting.ts";

function spend(overrides: Partial<TurnSpend> = {}): TurnSpend {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
    unknownTurns: 0,
    ...overrides,
  };
}

describe("research catalog labels", () => {
  it("shows an unknown total apart from a known zero", () => {
    assert.deepEqual(spendLabel(spend()), { total: "нет данных", note: null });
    assert.deepEqual(spendLabel(spend({ totalTokens: 0 })), { total: "0", note: null });
    assert.equal(
      spendLabel(spend({ totalTokens: 9, unknownTurns: 1 })).note,
      "По одному ходу нет данных.",
    );
    assert.equal(
      spendLabel(spend({ totalTokens: 12, unknownTurns: 2 })).note,
      "По 2 ходам нет данных.",
    );
  });

  it("keeps only http and https links", () => {
    assert.equal(reportLinkHref("https://github.com/vitejs/vite/issues/1"), "https://github.com/vitejs/vite/issues/1");
    assert.equal(reportLinkHref("javascript:alert(1)"), null);
    assert.equal(reportLinkHref("not a url"), null);
  });
});
