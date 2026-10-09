import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ConnectorGrant } from "./types.ts";

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
