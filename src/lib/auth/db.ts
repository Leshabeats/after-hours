import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteJournal, upsertUser, type JournalRepo } from "@/lib/journal/store";
import type { SessionUser } from "@/lib/journal/types";
import { createSqliteResearch, type ResearchRepo } from "@/lib/research/store";
import { createSqliteUsage, type UsageRepo } from "@/lib/usage/store";
import { dataDir } from "./paths.ts";

let journal: JournalRepo | undefined;
let usage: UsageRepo | undefined;
let research: ResearchRepo | undefined;
let sqlite: DatabaseSync | undefined;

function openDb() {
  if (sqlite) return sqlite;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  sqlite = new DatabaseSync(join(dir, "after-hours.sqlite"));
  return sqlite;
}

export function getJournalRepo(): JournalRepo {
  if (!journal) journal = createSqliteJournal(openDb());
  return journal;
}

export function getUsageRepo(): UsageRepo {
  if (!usage) usage = createSqliteUsage(openDb());
  return usage;
}

export function getResearchRepo(): ResearchRepo {
  if (!research) research = createSqliteResearch(openDb());
  return research;
}

export function saveUser(user: SessionUser) {
  getJournalRepo();
  upsertUser(openDb(), user);
}
