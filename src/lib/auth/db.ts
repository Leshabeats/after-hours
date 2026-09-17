import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteJournal, upsertUser, type JournalRepo } from "@/lib/journal/store";
import type { SessionUser } from "@/lib/journal/types";

let journal: JournalRepo | undefined;
let sqlite: DatabaseSync | undefined;

function openDb() {
  if (sqlite) return sqlite;
  const dir = join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  sqlite = new DatabaseSync(join(dir, "after-hours.sqlite"));
  return sqlite;
}

export function getJournalRepo(): JournalRepo {
  if (!journal) journal = createSqliteJournal(openDb());
  return journal;
}

export function saveUser(user: SessionUser) {
  getJournalRepo();
  upsertUser(openDb(), user);
}
