import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Windows cannot CreateProcess `npm.cmd`. Node runs that shim through cmd.exe. */
export function previewLaunch(platform = process.platform) {
  if (platform === "win32") {
    return { command: "npm.cmd", args: ["run", "preview"], shell: true };
  }
  return { command: "npm", args: ["run", "preview"], shell: false };
}

/** How to stop a preview process and the children it spawned. */
export function treeKillPlan(pid, signal, platform = process.platform) {
  if (!pid) return null;
  if (platform === "win32") {
    const args = ["/pid", String(pid), "/t"];
    if (signal === "SIGKILL") args.push("/f");
    return { kind: "taskkill", args };
  }
  return { kind: "group", signal, pid: -Math.abs(pid) };
}

/** State field from `/proc/<pid>/stat`. The command name may contain parentheses. */
export function procStatState(stat) {
  const end = stat.lastIndexOf(")");
  if (end === -1) return "";
  return stat.slice(end + 1).trimStart().split(" ", 1)[0] ?? "";
}

function isDefunct(pid) {
  if (process.platform !== "linux") return false;
  try {
    return procStatState(readFileSync(`/proc/${pid}/stat`, "utf8")) === "Z";
  } catch {
    return false;
  }
}

/** A zombie still accepts `kill(pid, 0)` when PID 1 does not reap it. */
export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error?.code === "EPERM";
  }
  return !isDefunct(pid);
}

export function killTree(pid, signal = "SIGTERM") {
  const plan = treeKillPlan(pid, signal);
  if (!plan) return;
  if (plan.kind === "taskkill") {
    spawnSync("taskkill", plan.args, { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(plan.pid, plan.signal);
  } catch {
    try {
      process.kill(Math.abs(pid), signal);
    } catch {
      // already gone
    }
  }
}

export async function stopPreview(pid, { listening, graceMs = 8_000, intervalMs = 200 } = {}) {
  if (!pid) return;
  killTree(pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (listening && !(await listening())) return;
    if (!listening && !isAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  killTree(pid, "SIGKILL");
}

/**
 * Ctrl-C and SIGTERM exit without `finally`, and a detached preview is not in
 * this process group. Kill that tree before exiting.
 */
export function installShutdown({ pid, afterKill }) {
  let stopping = false;
  const handler = (signal) => {
    if (stopping) return;
    stopping = true;
    const current = pid();
    try {
      killTree(current, "SIGTERM");
      killTree(current, "SIGKILL");
      afterKill?.();
    } finally {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
