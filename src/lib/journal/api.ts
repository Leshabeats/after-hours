import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { KINDS } from "@/lib/kinds";
import { githubOAuthConfigured } from "@/lib/auth/flags";
import {
  LOG_STATUSES,
  type AuthSnapshot,
  type LogEntry,
} from "./types";

const takeInput = z.object({
  id: z.string().min(1).max(160),
  owner: z.string().min(1).max(80),
  repo: z.string().min(1).max(80),
  number: z.number().int().positive(),
  title: z.string().min(1).max(300),
  kind: z.enum(KINDS),
  url: z.string().url().max(400),
  isPr: z.boolean(),
});

async function loadSession() {
  const { readSession } = await import("@/lib/auth/session");
  return readSession();
}

async function loadJournal() {
  const { getJournalRepo } = await import("@/lib/auth/db");
  return getJournalRepo();
}

export const getAuthSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthSnapshot> => {
    const configured = githubOAuthConfigured();
    try {
      const user = await loadSession();
      if (!user) return { configured, user: null, entries: null };
      const entries = (await loadJournal()).list(user.id);
      return { configured, user, entries };
    } catch {
      return { configured, user: null, entries: null };
    }
  },
);

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { clearSession } = await import("@/lib/auth/session");
  clearSession();
  return { ok: true as const };
});

export const takeNight = createServerFn({ method: "POST" })
  .validator(takeInput)
  .handler(async ({ data }): Promise<{ ok: "anonymous" } | { ok: "account"; entries: LogEntry[] }> => {
    const user = await loadSession();
    if (!user) return { ok: "anonymous" };
    const entries = (await loadJournal()).take(user.id, {
      ...data,
      status: "taken",
      takenAt: Date.now(),
    });
    return { ok: "account", entries };
  });

export const setNightStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1).max(160),
      status: z.enum(LOG_STATUSES),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: "anonymous" } | { ok: "account"; entries: LogEntry[] } | { ok: false }> => {
      const user = await loadSession();
      if (!user) return { ok: "anonymous" };
      const entries = (await loadJournal()).setStatus(user.id, data.id, data.status);
      if (!entries) return { ok: false };
      return { ok: "account", entries };
    },
  );

export const dropNight = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(160) }))
  .handler(
    async ({
      data,
    }): Promise<{ ok: "anonymous" } | { ok: "account"; entries: LogEntry[] } | { ok: false }> => {
      const user = await loadSession();
      if (!user) return { ok: "anonymous" };
      const entries = (await loadJournal()).drop(user.id, data.id);
      if (!entries) return { ok: false };
      return { ok: "account", entries };
    },
  );
