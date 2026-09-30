import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codexAppChatUrl } from "./codex-link.ts";

describe("codexAppChatUrl", () => {
  it("opens a new Codex app chat with the prompt", () => {
    const url = new URL(codexAppChatUrl("Fix the bug\nnow"));
    assert.equal(url.protocol, "codex:");
    assert.equal(url.hostname, "threads");
    assert.equal(url.pathname, "/new");
    assert.equal(url.searchParams.get("prompt"), "Fix the bug\nnow");
  });
});
