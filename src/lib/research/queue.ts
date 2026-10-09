import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type QueuePostResult = { ok: boolean; status: number };

export type ResearchQueue = {
  pending: Record<string, unknown>;
  blocked: Record<string, { status: number; body: unknown }>;
};

export function emptyQueue(): ResearchQueue {
  return { pending: {}, blocked: {} };
}

export function readQueue(path: string): ResearchQueue {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyQueue();
    }
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<ResearchQueue> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Research queue is not an object.");
  }
  return {
    pending: objectMap(parsed.pending),
    blocked: blockedMap(parsed.blocked),
  };
}

export function writeQueue(path: string, queue: ResearchQueue) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(queue)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

export function enqueue(queue: ResearchQueue, threadId: string, body: unknown): ResearchQueue {
  const blocked = { ...queue.blocked };
  delete blocked[threadId];
  return {
    pending: { ...queue.pending, [threadId]: body },
    blocked,
  };
}

/**
 * One pass. 200 removes the item. 400 and 409 park it so the same body is not sent again.
 * 401 and a network failure leave the current item and stop the pass.
 */
export async function flushQueue(
  queue: ResearchQueue,
  post: (body: unknown) => Promise<QueuePostResult>,
  save?: (queue: ResearchQueue) => void,
): Promise<{ queue: ResearchQueue; stopped: null | "network" | "unauthorized" }> {
  const next: ResearchQueue = {
    pending: { ...queue.pending },
    blocked: { ...queue.blocked },
  };
  for (const threadId of Object.keys(next.pending).sort()) {
    const body = next.pending[threadId];
    let result: QueuePostResult;
    try {
      result = await post(body);
    } catch {
      save?.(next);
      return { queue: next, stopped: "network" };
    }
    if (result.ok) {
      delete next.pending[threadId];
      save?.(next);
      continue;
    }
    if (result.status === 400 || result.status === 409) {
      delete next.pending[threadId];
      next.blocked[threadId] = { status: result.status, body };
      save?.(next);
      continue;
    }
    save?.(next);
    return { queue: next, stopped: result.status === 401 ? "unauthorized" : "network" };
  }
  save?.(next);
  return { queue: next, stopped: null };
}

function objectMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function blockedMap(value: unknown): ResearchQueue["blocked"] {
  const source = objectMap(value);
  const blocked: ResearchQueue["blocked"] = {};
  for (const [threadId, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.status !== "number" || !("body" in record)) continue;
    blocked[threadId] = { status: record.status, body: record.body };
  }
  return blocked;
}
