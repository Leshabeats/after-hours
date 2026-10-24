import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { it } from "node:test";
import { createPool } from "./postgres.ts";

it("runtime pool sends only pooler-compatible startup parameters", { timeout: 5000 }, async () => {
  let parameters: string[] = [];
  const server = createServer((socket) => {
    let packet = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      packet = Buffer.concat([packet, chunk]);
      if (packet.length < 4 || packet.length < packet.readInt32BE(0)) return;
      assert.equal(packet.readInt32BE(4), 196608, "PostgreSQL protocol 3.0");
      const fields = packet
        .subarray(8, packet.readInt32BE(0) - 1)
        .toString()
        .split("\0");
      parameters = fields.filter((_, index) => index % 2 === 0 && fields[index] !== "");
      socket.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const pool = createPool(`postgresql://fixture@127.0.0.1:${address.port}/fixture?sslmode=disable`);
  try {
    await assert.rejects(pool.connect(), /Connection terminated unexpectedly/);
    assert.ok(parameters.includes("user") && parameters.includes("database"));
    const supported = new Set([
      "user",
      "database",
      "client_encoding",
      "datestyle",
      "timezone",
      "standard_conforming_strings",
      "application_name",
    ]);
    assert.deepEqual(
      parameters.filter((key) => !supported.has(key)),
      [],
    );
  } finally {
    await pool.end();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
