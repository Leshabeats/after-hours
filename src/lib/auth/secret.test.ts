import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signPayload, verifyPayload } from "./secret.ts";

describe("signed payloads", () => {
  it("round-trips and rejects tampering", () => {
    const secret = "a".repeat(32);
    const token = signPayload({ id: "1", exp: Date.now() + 60_000 }, secret);
    const ok = verifyPayload<{ id: string }>(token, secret);
    assert.equal(ok?.id, "1");
    assert.equal(verifyPayload(token.slice(0, -1) + "x", secret), null);
  });
});
