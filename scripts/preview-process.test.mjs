import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isAlive, killTree, previewLaunch, procStatState, stopPreview, treeKillPlan } from "./preview-process.mjs";

const moduleUrl = new URL("./preview-process.mjs", import.meta.url).href;

function waitExit(child, timeoutMs = 3_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("process stayed alive")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function readPidFile(file, timeoutMs = 5_000) {
  const text = await readReadyFile(file, timeoutMs);
  const pid = Number(text);
  if (!(pid > 0)) throw new Error(`bad pid in ${file}`);
  return pid;
}

async function readReadyFile(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`no file ${file}`);
}

describe("preview process stop", () => {
  it("plans windows launch and stop, and reads a defunct proc state", () => {
    assert.equal(treeKillPlan(0, "SIGTERM", "win32"), null);
    assert.deepEqual(treeKillPlan(42, "SIGTERM", "win32"), {
      kind: "taskkill",
      args: ["/pid", "42", "/t"],
    });
    assert.deepEqual(treeKillPlan(42, "SIGKILL", "win32"), {
      kind: "taskkill",
      args: ["/pid", "42", "/t", "/f"],
    });
    assert.deepEqual(treeKillPlan(42, "SIGTERM", "linux"), {
      kind: "group",
      signal: "SIGTERM",
      pid: -42,
    });
    assert.deepEqual(previewLaunch("win32"), {
      command: "npm.cmd",
      args: ["run", "preview"],
      shell: true,
    });
    assert.deepEqual(previewLaunch("linux"), {
      command: "npm",
      args: ["run", "preview"],
      shell: false,
    });
    assert.equal(procStatState("123 (node) Z 1 1"), "Z");
    assert.equal(procStatState("123 (foo) bar) S 1"), "S");
    assert.equal(procStatState("no paren"), "");
  });

  it("kills a detached process group, including the grandchild", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-preview-tree-"));
    const pidFile = join(dir, "grandchild");
    const parent = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000000)"], { stdio: "ignore" });
        writeFileSync(process.env.GRANDCHILD_PID_FILE, String(grandchild.pid));
        setInterval(() => {}, 1000000);
        `,
      ],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, GRANDCHILD_PID_FILE: pidFile },
      },
    );
    let grandchild = 0;
    try {
      grandchild = await readPidFile(pidFile);
      assert.equal(isAlive(grandchild), true);
      killTree(parent.pid, "SIGKILL");
      await waitExit(parent);
      const deadline = Date.now() + 3_000;
      while (isAlive(grandchild) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(isAlive(grandchild), false);
    } finally {
      if (grandchild) killTree(grandchild, "SIGKILL");
      killTree(parent.pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("escalates to SIGKILL when the preview ignores SIGTERM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-preview-term-"));
    const readyFile = join(dir, "ready");
    const stubborn = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import { writeFileSync } from "node:fs";
        process.on("SIGTERM", () => {});
        writeFileSync(process.env.READY_FILE, "ready");
        setInterval(() => {}, 1000000);
        `,
      ],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, READY_FILE: readyFile },
      },
    );
    let dead = false;
    stubborn.once("exit", () => {
      dead = true;
    });
    try {
      await readReadyFile(readyFile);
      const started = Date.now();
      await stopPreview(stubborn.pid, {
        listening: async () => !dead,
        graceMs: 400,
        intervalMs: 50,
      });
      await waitExit(stubborn);
      assert.equal(dead, true);
      assert.ok(Date.now() - started >= 400);
    } finally {
      killTree(stubborn.pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("kills the detached child when the parent receives SIGTERM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-preview-stop-"));
    const pidFile = join(dir, "pid");
    const cleanFile = join(dir, "clean");
    const wrapper = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        import { installShutdown } from ${JSON.stringify(moduleUrl)};
        const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000000)"], {
          detached: true,
          stdio: "ignore",
        });
        sleeper.unref();
        installShutdown({
          pid: () => sleeper.pid,
          afterKill() {
            writeFileSync(process.env.SMOKE_CLEAN_FILE, "cleaned");
          },
        });
        writeFileSync(process.env.SMOKE_PID_FILE, String(sleeper.pid));
        setInterval(() => {}, 1000000);
        `,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SMOKE_PID_FILE: pidFile, SMOKE_CLEAN_FILE: cleanFile },
      },
    );
    let sleeper = 0;
    try {
      sleeper = await readPidFile(pidFile);
      assert.equal(isAlive(sleeper), true);
      process.kill(wrapper.pid, "SIGTERM");
      await waitExit(wrapper);
      assert.equal(wrapper.exitCode, 143);
      assert.equal(readFileSync(cleanFile, "utf8"), "cleaned");
      const gone = Date.now() + 3_000;
      while (isAlive(sleeper) && Date.now() < gone) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(isAlive(sleeper), false);
    } finally {
      if (sleeper) killTree(sleeper, "SIGKILL");
      try {
        wrapper.kill("SIGKILL");
      } catch {
        // already gone
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
