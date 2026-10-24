import { getPool } from "../db/postgres.ts";
import { createPostgresJournal, upsertUser, type JournalRepo } from "../journal/store.ts";
import type { SessionUser } from "../journal/types.ts";
import { createPostgresResearch, type ResearchRepo } from "../research/store.ts";
import { createPostgresUsage, type UsageRepo } from "../usage/store.ts";

let journal: JournalRepo | undefined;
let usage: UsageRepo | undefined;
let research: ResearchRepo | undefined;

export function getJournalRepo(): JournalRepo {
  return (journal ??= createPostgresJournal(getPool()));
}
export function getUsageRepo(): UsageRepo {
  return (usage ??= createPostgresUsage(getPool()));
}
export function getResearchRepo(): ResearchRepo {
  return (research ??= createPostgresResearch(getPool()));
}
export async function saveUser(user: SessionUser) {
  await upsertUser(getPool(), user);
}
