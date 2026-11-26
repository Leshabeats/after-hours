import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mode = process.env.CLAUDE_SMOKE_MODE;
assert.notEqual(mode, "must-not-run", "flush must never launch Claude");
const i = process.argv.indexOf("--mcp-config");
const { mcpServers } = JSON.parse(await readFile(process.argv[i + 1], "utf8"));
assert.deepEqual(Object.keys(mcpServers), ["afterhours"]);
const { url, headers } = mcpServers.afterhours;
assert.deepEqual(Object.keys(headers), ["Authorization"]);
const run_id = process.argv.at(-1).match(/mcp_[a-f0-9]{48}/)[0];
const client = new Client({ name: "fixture-claude", version: "1" });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }),
  );
  const call = (name, args) => client.callTool({ name, arguments: args });
  const existing = await call("get_research", { run_id });
  assert.equal(existing.structuredContent.status, "in_progress");
  const report = {
    schemaVersion: 1,
    findings: `Claude public report ${mode}`,
    work: "Fixture work",
    evidence: [],
    unknowns: [],
    nextSteps: [],
    links: [],
  };
  if (mode !== "pending") {
    const uploaded = await call("submit_report", { run_id, report });
    assert.equal(uploaded.structuredContent.published, true);
    assert.equal(uploaded.structuredContent.usage, null);
    assert.equal((await call("submit_report", { run_id, report })).structuredContent.replay, true);
    const page = await fetch(new URL("/m/smoke/claude/9", url));
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(report.findings) && html.includes("нет данных"));
  }

  const meas = {
    input_tokens: 2,
    output_tokens: 50,
    cache_creation_input_tokens: 3342,
    cache_read_input_tokens: 0,
  };
  console.log(
    JSON.stringify({
      type: "assistant",
      message: { usage: meas, content: [{ type: "text", text: "My estimated usage is 77777" }] },
    }),
  );
  console.log(
    JSON.stringify({
      type: "result",
      subtype: mode === "failed" ? "error_during_execution" : "success",
      is_error: mode === "failed",
      usage: mode === "missing" ? { output_tokens: 50 } : meas,
      total_cost_usd: 23,
    }),
  );
  if (mode === "failed") process.exitCode = 1;
} finally {
  await client.close();
}
