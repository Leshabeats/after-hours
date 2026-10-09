import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthorBoard, MissionBoard } from "./catalog.ts";
import type { LimitSnapshot, ConnectorGrant } from "./types.ts";

export type GrantLoad =
  | { ok: "anonymous" }
  | { ok: "error" }
  | { ok: "account"; grants: ConnectorGrant[] };

async function loadSession() {
  const { readSession } = await import("@/lib/auth/session");
  return readSession();
}

async function loadResearch() {
  const { getResearchRepo } = await import("@/lib/auth/db");
  return getResearchRepo();
}

export const listConnectorGrants = createServerFn({ method: "GET" }).handler(
  async (): Promise<GrantLoad> => {
    try {
      const user = await loadSession();
      if (!user) return { ok: "anonymous" };
      return { ok: "account", grants: (await loadResearch()).listGrants(user.id) };
    } catch {
      return { ok: "error" };
    }
  },
);

export const createConnectorGrant = createServerFn({ method: "POST" }).handler(
  async (): Promise<
    | { ok: "anonymous" }
    | { ok: "error" }
    | { ok: "account"; grant: ConnectorGrant; token: string }
  > => {
    try {
      const user = await loadSession();
      if (!user) return { ok: "anonymous" };
      const created = (await loadResearch()).createGrant(user.id, Date.now());
      return { ok: "account", grant: created.grant, token: created.token };
    } catch {
      return { ok: "error" };
    }
  },
);

export const revokeConnectorGrant = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().trim().min(1).max(80) }))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: "anonymous" } | { ok: "error" } | { ok: false } | { ok: "account"; grants: ConnectorGrant[] }
    > => {
      try {
        const user = await loadSession();
        if (!user) return { ok: "anonymous" };
        const grants = (await loadResearch()).revokeGrant(user.id, data.id, Date.now());
        if (!grants) return { ok: false };
        return { ok: "account", grants };
      } catch {
        return { ok: "error" };
      }
    },
  );

export type MissionReportLoad = { ok: "ready"; board: MissionBoard } | { ok: "error" };
export type AuthorReportLoad = { ok: "ready"; board: AuthorBoard } | { ok: "error" };
export type LimitLoad =
  | { ok: "anonymous" }
  | { ok: "error" }
  | { ok: "account"; limit: LimitSnapshot | null };

const missionQuery = z.object({
  owner: z.string().trim().min(1).max(80),
  repo: z.string().trim().min(1).max(120),
  number: z.number().int().positive(),
});

async function refreshThen<T extends { reports: { id: string }[]; hidden: { id: string }[] }>(
  load: () => T,
) {
  const repo = await loadResearch();
  const first = load();
  const ids = [...first.reports, ...first.hidden].map((item) => item.id);
  if (ids.length > 0) {
    try {
      await repo.refreshGithub(ids);
    } catch {
      // A failed poll still leaves the last saved board readable.
    }
  }
  return load();
}

export const listMissionReports = createServerFn({ method: "GET" })
  .validator(missionQuery)
  .handler(async ({ data }): Promise<MissionReportLoad> => {
    try {
      const user = await loadSession();
      const repo = await loadResearch();
      const viewer = user?.id ?? null;
      const board = await refreshThen(() =>
        repo.missionBoard(data.owner, data.repo, data.number, viewer),
      );
      return { ok: "ready", board };
    } catch {
      return { ok: "error" };
    }
  });

export const listAuthorReports = createServerFn({ method: "GET" })
  .validator(z.object({ login: z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/) }))
  .handler(async ({ data }): Promise<AuthorReportLoad> => {
    try {
      const user = await loadSession();
      const repo = await loadResearch();
      const board = await refreshThen(() => repo.authorBoard(data.login, user?.id ?? null));
      return { ok: "ready", board };
    } catch {
      return { ok: "error" };
    }
  });

export const readOwnLimit = createServerFn({ method: "GET" }).handler(
  async (): Promise<LimitLoad> => {
    try {
      const user = await loadSession();
      if (!user) return { ok: "anonymous" };
      return { ok: "account", limit: (await loadResearch()).readLimit(user.id) };
    } catch {
      return { ok: "error" };
    }
  },
);

export const setReportPublished = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().trim().min(1).max(80),
      published: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const user = await loadSession();
      if (!user) return { ok: "anonymous" as const };
      const result = (await loadResearch()).setPublished(
        user.id,
        data.id,
        data.published,
        Date.now(),
      );
      if (result === "updated") return { ok: "account" as const };
      return { ok: result };
    } catch {
      return { ok: "error" as const };
    }
  });
