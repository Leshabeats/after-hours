import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldMarkShipping } from "./take-night.ts";

describe("shouldMarkShipping", () => {
  it("does not move a shipped night back to shipping", () => {
    assert.equal(shouldMarkShipping(undefined), true);
    assert.equal(shouldMarkShipping("taken"), true);
    assert.equal(shouldMarkShipping("shipping"), true);
    assert.equal(shouldMarkShipping("shipped"), false);
  });
});
