import type { DiscoveryLoad, DiscoverySnapshot, DiscoveryWorld } from "./types.ts";
import { recentDiscoveryIssues } from "./presentation.ts";

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

async function publishedSnapshot(world: DiscoveryWorld): Promise<DiscoverySnapshot | null> {
  const [{ getPool }, { createPostgresDiscovery }] = await Promise.all([
    import("../db/postgres.ts"),
    import("./store.ts"),
  ]);
  return createPostgresDiscovery(getPool(), world).snapshot();
}

export function readWorldDiscovery(world: DiscoveryWorld): Promise<DiscoveryLoad> {
  return readDiscovery(() => publishedSnapshot(world));
}

/** Read one published snapshot only: never collect or refresh GitHub in a request. */
export async function readDiscovery(
  read: () => Promise<DiscoverySnapshot | null> = () => publishedSnapshot("games"),
  now = Date.now(),
): Promise<DiscoveryLoad> {
  try {
    const snapshot = await read();
    if (!snapshot) return { status: "empty", updatedAt: null, stale: false, cards: [] };
    const cards = snapshot.cards.filter((card) => card.isPublic === true);
    return {
      status: cards.length ? "ready" : "empty",
      updatedAt: snapshot.generatedAt,
      stale: now - snapshot.generatedAt > STALE_AFTER_MS,
      cards: cards.map((card) => ({
        ...card,
        live: false,
        ...(card.issues ? { issues: recentDiscoveryIssues(card, now) } : {}),
      })),
      ...(snapshot.issuesIndexed ? { issuesIndexed: true } : {}),
    };
  } catch {
    // The curated shelf remains usable before migration or while storage is unavailable.
    return { status: "unavailable", updatedAt: null, stale: false, cards: [] };
  }
}
