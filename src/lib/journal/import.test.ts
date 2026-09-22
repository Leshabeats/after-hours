import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideDeviceJournalUpload,
  deviceUploadFlagKey,
  MAX_DEVICE_IMPORT,
  readDeviceUploadFlag,
  writeDeviceUploadFlag,
} from "./import.ts";
import { importDeviceJournalSchema } from "./schema.ts";
import type { LogEntry } from "./types.ts";

function entry(id: string): LogEntry {
  return {
    id,
    owner: "vitejs",
    repo: "vite",
    number: 1,
    title: id,
    kind: "blinding",
    url: "https://github.com/vitejs/vite/issues/1",
    isPr: false,
    status: "taken",
    takenAt: 1,
  };
}

describe("decideDeviceJournalUpload", () => {
  it("uploads once when the account journal is empty and the device has nights", () => {
    assert.equal(
      decideDeviceJournalUpload({
        signedIn: true,
        serverCount: 0,
        localCount: 2,
        alreadyAttempted: false,
      }),
      "upload",
    );
  });

  it("keeps the server journal when both sides have nights", () => {
    assert.equal(
      decideDeviceJournalUpload({
        signedIn: true,
        serverCount: 1,
        localCount: 3,
        alreadyAttempted: false,
      }),
      "keep-server",
    );
  });

  it("skips anonymous, empty device, and a second attempt", () => {
    assert.equal(
      decideDeviceJournalUpload({
        signedIn: false,
        serverCount: 0,
        localCount: 2,
        alreadyAttempted: false,
      }),
      "skip",
    );
    assert.equal(
      decideDeviceJournalUpload({
        signedIn: true,
        serverCount: 0,
        localCount: 0,
        alreadyAttempted: false,
      }),
      "skip",
    );
    assert.equal(
      decideDeviceJournalUpload({
        signedIn: true,
        serverCount: 0,
        localCount: 2,
        alreadyAttempted: true,
      }),
      "skip",
    );
  });
});

describe("importDeviceJournalSchema", () => {
  it("drops a client-sent user id", () => {
    const parsed = importDeviceJournalSchema.parse({
      userId: "attacker",
      entries: [entry("vitejs/vite#1")],
    });
    assert.equal("userId" in parsed, false);
    assert.equal(parsed.entries[0]?.id, "vitejs/vite#1");
  });

  it("rejects a dump larger than the one-shot cap", () => {
    const entries = Array.from({ length: MAX_DEVICE_IMPORT + 1 }, (_, i) =>
      entry(`vitejs/vite#${i + 1}`),
    );
    assert.equal(importDeviceJournalSchema.safeParse({ entries }).success, false);
  });

  it("keeps valid nights when one row is too long", () => {
    const parsed = importDeviceJournalSchema.parse({
      entries: [entry("vitejs/vite#1"), { ...entry("bad"), repo: "r".repeat(101) }],
    });
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.skipped, 1);
    assert.equal(parsed.entries[0]?.id, "vitejs/vite#1");
  });
});

describe("device upload flag", () => {
  it("is per user and does not leak across accounts", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    writeDeviceUploadFlag("1", storage);
    assert.equal(readDeviceUploadFlag("1", storage), true);
    assert.equal(readDeviceUploadFlag("2", storage), false);
    assert.equal(data.get(deviceUploadFlagKey("1")), "1");
  });
});
