import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultAgentPrompt, type AgentPromptMission } from "./agent-prompt.ts";

function mission(isPr: boolean): AgentPromptMission {
  return {
    owner: "vitejs",
    repo: "vite",
    url: isPr ? "https://github.com/vitejs/vite/pull/5" : "https://github.com/vitejs/vite/issues/5",
    title: "Night",
    body: "Steps to reproduce.",
    isPr,
  };
}

describe("defaultAgentPrompt", () => {
  it("asks for research on an issue and does not ask for a fix", () => {
    const prompt = defaultAgentPrompt(mission(false));
    assert.match(prompt, /Study this issue/);
    assert.equal(prompt.includes("Study this pull request"), false);
    assert.equal(prompt.includes("smallest correct change"), false);
    assert.equal(prompt.includes("Close or review"), false);
    assert.match(prompt, /Do not implement a fix/);
    assert.match(prompt, /CONTRIBUTING/);
    assert.match(prompt, /Already fixed/);
    assert.match(prompt, /schemaVersion/);
    assert.match(prompt, /Do not put token counts/);
  });

  it("names a pull request when the mission is a pull request", () => {
    const prompt = defaultAgentPrompt(mission(true));
    assert.match(prompt, /Study this pull request/);
    assert.equal(prompt.includes("Study this issue"), false);
    assert.match(prompt, /pull request: https:\/\/github.com\/vitejs\/vite\/pull\/5/);
    assert.equal(prompt.includes("smallest correct change"), false);
  });
});
