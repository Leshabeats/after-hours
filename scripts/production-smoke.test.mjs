import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");

function smokeDirs() {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("ah12-smoke-")));
}

async function expectPortBusy(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4173, "127.0.0.1", resolve);
  });
  const before = smokeDirs();
  const child = spawn(process.execPath, ["scripts/production-smoke.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 1);
    assert.match(stderr, /port 4173 is already in use/);
    const after = smokeDirs();
    for (const name of after) assert.equal(before.has(name), true, name);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("production smoke", { concurrency: false }, () => {
  it("removes the temp directory when port 4173 is taken", { timeout: 15_000 }, async () => {
    await expectPortBusy(
      createServer((_request, response) => {
        response.writeHead(200);
        response.end("busy");
      }),
    );
  });

  it("treats an HTTP 503 listener as an occupied port", { timeout: 15_000 }, async () => {
    await expectPortBusy(
      createServer((_request, response) => {
        response.writeHead(503);
        response.end("no");
      }),
    );
  });

  it("treats a raw TCP listener as an occupied port", { timeout: 15_000 }, async () => {
    await expectPortBusy(createTcpServer());
  });
});
