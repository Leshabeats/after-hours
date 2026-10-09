import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseResearchReport } from "./schema.ts";

const report = `{
  "schemaVersion": 1,
  "findings": "Уже исправлено",
  "work": "Сверил обсуждение и код.",
  "evidence": ["Тест на main зелёный."],
  "unknowns": ["Нет Windows."],
  "nextSteps": ["Спросить автора."],
  "links": [{ "url": "https://github.com/vitejs/vite/issues/1", "kind": "issue" }],
  "inputTokens": 99999
}`;

describe("parseResearchReport", () => {
  it("reads the last json fence and drops token fields", () => {
    const text = `Черновик\n\`\`\`json\n{"schemaVersion":1}\n\`\`\`\nИтог\n\`\`\`json\n${report}\n\`\`\``;
    const parsed = parseResearchReport(text);
    assert.equal(parsed?.findings, "Уже исправлено");
    assert.equal(parsed && "inputTokens" in parsed, false);
  });

  it("returns null when the fence is not a v1 report", () => {
    assert.equal(parseResearchReport("просто текст, токенов 99999"), null);
    assert.equal(parseResearchReport("```json\n{\"schemaVersion\":1,\"findings\":\" \"}\n```"), null);
  });
});
