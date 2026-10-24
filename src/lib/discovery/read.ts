import type { DiscoveryLoad, DiscoverySnapshot } from "./types.ts";

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

async function publishedSnapshot(): Promise<DiscoverySnapshot | null> {
  const [{ getPool }, { createPostgresDiscovery }] = await Promise.all([
    import("../db/postgres.ts"),
    import("./store.ts"),
  ]);
  return createPostgresDiscovery(getPool()).snapshot();
}

/** Read one published snapshot only: never collect or refresh GitHub in a request. */
export async function readDiscovery(
  read: () => Promise<DiscoverySnapshot | null> = publishedSnapshot,
  now = Date.now(),
): Promise<DiscoveryLoad> {
  try {
    const snapshot = await read();
    if (!snapshot) return { status: "empty", updatedAt: null, stale: false, cards: [] };
    return {
      status: snapshot.cards.length ? "ready" : "empty",
      updatedAt: snapshot.generatedAt,
      stale: now - snapshot.generatedAt > STALE_AFTER_MS,
      cards: snapshot.cards.map((card) => ({ ...card, live: false })),
    };
  } catch {
    // The curated shelf remains usable before migration or while storage is unavailable.
    return { status: "unavailable", updatedAt: null, stale: false, cards: [] };
  }
}
