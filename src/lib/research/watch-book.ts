import type { DatabaseSync } from "node:sqlite";
import {
  coordKey,
  emptyHistory,
  emptySubject,
  planBindings,
  shouldRefresh,
  subjectCard,
  type FactDraft,
  type FactKind,
  type GithubHistory,
  type PlannedLink,
  type SubjectRow,
  type WatchRun,
} from "./github-watch.ts";

export type WatchBook = {
  bind(run: WatchRun): void;
  due(runIds: readonly string[], now: number, pausedUntil: number): SubjectRow[];
  read(id: string): SubjectRow | null;
  apply(id: string, row: SubjectRow, facts: readonly FactDraft[]): void;
  saveClosing(id: string, prs: readonly { number: number; merged: boolean }[]): void;
  history(runs: readonly { id: string; researcherLogin: string }[]): Map<string, GithubHistory>;
  closingSources(
    runs: readonly { id: string; researcherLogin: string }[],
  ): { id: string; owner: string; repo: string; number: number; closingKnown: boolean }[];
};

type LinkRecord = {
  runId: string;
  subjectId: string;
  relation: PlannedLink["relation"];
  url: string;
};

type FactRecord = FactDraft & { subjectId: string };

function cloneSubject(row: SubjectRow): SubjectRow {
  return { ...row, closingPrs: row.closingPrs.map((pr) => ({ ...pr })) };
}

export function historiesFrom(
  runs: readonly { id: string; researcherLogin: string }[],
  links: readonly LinkRecord[],
  subjects: readonly SubjectRow[],
  facts: readonly FactRecord[],
): Map<string, GithubHistory> {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const factsOf = new Map<string, { kind: FactKind; at: number }[]>();
  for (const fact of facts) {
    const list = factsOf.get(fact.subjectId) ?? [];
    list.push({ kind: fact.kind, at: fact.at });
    factsOf.set(fact.subjectId, list);
  }
  for (const list of factsOf.values()) {
    list.sort((a, b) => b.at - a.at || (a.kind < b.kind ? -1 : 1));
    list.splice(8);
  }
  const out = new Map<string, GithubHistory>();
  for (const run of runs) {
    const mine = links.filter((link) => link.runId === run.id);
    const sourceLink = mine.find((link) => link.relation === "source");
    const source = sourceLink ? byId.get(sourceLink.subjectId) : undefined;
    const closing =
      source && source.closingKnown && source.isPublic !== false ? source.closingPrs : null;
    const cardFor = (subject: SubjectRow, explicitlyLinked: boolean) =>
      subjectCard(subject, {
        researcherLogin: run.researcherLogin,
        explicitlyLinked,
        closing,
        facts: factsOf.get(subject.id) ?? [],
      });
    out.set(run.id, {
      source: source ? cardFor(source, false) : null,
      links: mine.flatMap((link) => {
        if (link.relation !== "linked") return [];
        const subject = byId.get(link.subjectId);
        return subject ? [cardFor(subject, subject.kind === "pull")] : [];
      }),
    });
  }
  return out;
}

function rememberLink(links: LinkRecord[], link: LinkRecord) {
  const exists = links.some(
    (item) =>
      item.runId === link.runId &&
      item.subjectId === link.subjectId &&
      item.relation === link.relation,
  );
  if (!exists) links.push(link);
}

function retarget(links: LinkRecord[], from: string, to: string) {
  for (const link of [...links]) {
    if (link.subjectId !== from) continue;
    const clash = links.some(
      (item) =>
        item !== link &&
        item.runId === link.runId &&
        item.subjectId === to &&
        item.relation === link.relation,
    );
    if (clash) {
      const index = links.indexOf(link);
      if (index >= 0) links.splice(index, 1);
    } else {
      link.subjectId = to;
    }
  }
}

export function createMemoryWatch(newId: () => string): WatchBook {
  const subjects: SubjectRow[] = [];
  const links: LinkRecord[] = [];
  const facts: FactRecord[] = [];

  function findCoord(coord: PlannedLink) {
    const key = coordKey(coord);
    return subjects.find((subject) => coordKey(subject) === key) ?? null;
  }

  function ensure(planned: PlannedLink) {
    const found = findCoord(planned);
    if (found) return found;
    const created = emptySubject(newId(), planned);
    subjects.push(created);
    return created;
  }

  return {
    bind(run) {
      for (const planned of planBindings(run)) {
        const subject = ensure(planned);
        rememberLink(links, {
          runId: run.id,
          subjectId: subject.id,
          relation: planned.relation,
          url: planned.url,
        });
      }
    },
    due(runIds, now, pausedUntil) {
      const wanted = new Set(runIds);
      const ids = new Set(
        links.filter((link) => wanted.has(link.runId)).map((link) => link.subjectId),
      );
      return subjects
        .filter((subject) => ids.has(subject.id) && shouldRefresh(subject, now, pausedUntil))
        .sort((a, b) => (a.checkedAt ?? -1) - (b.checkedAt ?? -1) || (a.id < b.id ? -1 : 1))
        .map(cloneSubject);
    },
    read(id) {
      const row = subjects.find((subject) => subject.id === id);
      return row ? cloneSubject(row) : null;
    },
    apply(id, row, nextFacts) {
      let target = id;
      if (row.nodeId) {
        const other = subjects.find((subject) => subject.nodeId === row.nodeId && subject.id !== target);
        if (other) {
          retarget(links, target, other.id);
          const index = subjects.findIndex((subject) => subject.id === target);
          if (index >= 0) subjects.splice(index, 1);
          target = other.id;
        }
      }
      const coord = subjects.find(
        (subject) => subject.id !== target && coordKey(subject) === coordKey(row),
      );
      if (coord) {
        retarget(links, target, coord.id);
        const index = subjects.findIndex((subject) => subject.id === target);
        if (index >= 0) subjects.splice(index, 1);
        target = coord.id;
      }
      const index = subjects.findIndex((subject) => subject.id === target);
      const stored = cloneSubject({ ...row, id: target });
      if (index === -1) subjects.push(stored);
      else subjects[index] = stored;
      for (const fact of nextFacts) {
        const seen = facts.some(
          (item) =>
            item.subjectId === target && item.kind === fact.kind && item.detail === fact.detail,
        );
        if (!seen) facts.push({ ...fact, subjectId: target });
      }
    },
    saveClosing(id, prs) {
      const row = subjects.find((subject) => subject.id === id);
      if (!row) return;
      row.closingKnown = true;
      row.closingPrs = prs.map((pr) => ({ ...pr }));
    },
    history(runs) {
      const ids = new Set(runs.map((run) => run.id));
      const mine = links.filter((link) => ids.has(link.runId));
      const subjectIds = new Set(mine.map((link) => link.subjectId));
      return historiesFrom(
        runs,
        mine,
        subjects.filter((subject) => subjectIds.has(subject.id)).map(cloneSubject),
        facts.filter((fact) => subjectIds.has(fact.subjectId)),
      );
    },
    closingSources(runs) {
      const histories = this.history(runs);
      const out: {
        id: string;
        owner: string;
        repo: string;
        number: number;
        closingKnown: boolean;
      }[] = [];
      for (const run of runs) {
        const history = histories.get(run.id) ?? emptyHistory();
        const candidate = history.links.some(
          (link) => link.kind === "pull" && link.state === "merged" && link.byResearcher,
        );
        if (!candidate || !history.source || history.source.kind !== "issue") continue;
        const link = links.find((item) => item.runId === run.id && item.relation === "source");
        const source = link ? subjects.find((subject) => subject.id === link.subjectId) : undefined;
        if (!source || source.isPublic === false) continue;
        out.push({
          id: source.id,
          owner: source.owner,
          repo: source.repo,
          number: source.number,
          closingKnown: source.closingKnown,
        });
      }
      return out;
    },
  };
}

type SubjectSql = {
  id: string;
  node_id: string | null;
  kind: string;
  owner: string;
  repo: string;
  number: number;
  author_login: string | null;
  title: string | null;
  html_url: string | null;
  is_public: number | null;
  state: string;
  draft: number;
  review: string | null;
  comment_count: number | null;
  checked_at: number | null;
  error: string | null;
  closing_known: number;
  closing_json: string | null;
};

function fromSql(row: SubjectSql): SubjectRow | null {
  if (row.kind !== "issue" && row.kind !== "pull") return null;
  if (
    row.state !== "unknown" &&
    row.state !== "open" &&
    row.state !== "closed" &&
    row.state !== "merged"
  ) {
    return null;
  }
  const review =
    row.review === "changes_requested" || row.review === "approved" || row.review === "unknown"
      ? row.review
      : null;
  const error =
    row.error === "unavailable" || row.error === "rate" || row.error === "private" ? row.error : null;
  let closingPrs: SubjectRow["closingPrs"] = [];
  if (row.closing_json) {
    try {
      const parsed = JSON.parse(row.closing_json) as { number?: number; merged?: boolean }[];
      closingPrs = parsed.flatMap((pr) =>
        typeof pr.number === "number" ? [{ number: pr.number, merged: Boolean(pr.merged) }] : [],
      );
    } catch {
      closingPrs = [];
    }
  }
  return {
    id: row.id,
    nodeId: row.node_id,
    kind: row.kind,
    owner: row.owner,
    repo: row.repo,
    number: row.number,
    authorLogin: row.author_login,
    title: row.title,
    htmlUrl: row.html_url,
    isPublic: row.is_public == null ? null : Boolean(row.is_public),
    state: row.state,
    draft: Boolean(row.draft),
    review,
    commentCount: row.comment_count,
    checkedAt: row.checked_at,
    error,
    closingKnown: Boolean(row.closing_known),
    closingPrs,
  };
}

export function createSqliteWatch(db: DatabaseSync, newId: () => string): WatchBook {
  db.exec(`
    CREATE TABLE IF NOT EXISTS github_subjects (
      id TEXT PRIMARY KEY,
      node_id TEXT,
      kind TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      author_login TEXT,
      title TEXT,
      html_url TEXT,
      is_public INTEGER,
      state TEXT NOT NULL,
      draft INTEGER NOT NULL DEFAULT 0,
      review TEXT,
      comment_count INTEGER,
      checked_at INTEGER,
      error TEXT,
      closing_known INTEGER NOT NULL DEFAULT 0,
      closing_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS github_subjects_node
      ON github_subjects(node_id) WHERE node_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS github_subjects_coord
      ON github_subjects(kind, owner COLLATE NOCASE, repo COLLATE NOCASE, number);
    CREATE TABLE IF NOT EXISTS research_links (
      run_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      url TEXT NOT NULL,
      PRIMARY KEY (run_id, subject_id, relation)
    );
    CREATE TABLE IF NOT EXISTS github_facts (
      subject_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (subject_id, kind, detail)
    );
  `);
  const byCoord = db.prepare(
    `SELECT * FROM github_subjects
     WHERE kind = ? AND owner = ? COLLATE NOCASE AND repo = ? COLLATE NOCASE AND number = ?`,
  );
  const byNode = db.prepare(`SELECT * FROM github_subjects WHERE node_id = ?`);
  const byId = db.prepare(`SELECT * FROM github_subjects WHERE id = ?`);
  const insert = db.prepare(
    `INSERT INTO github_subjects (
      id, node_id, kind, owner, repo, number, author_login, title, html_url, is_public,
      state, draft, review, comment_count, checked_at, error, closing_known, closing_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE github_subjects SET
      node_id = ?, kind = ?, owner = ?, repo = ?, number = ?, author_login = ?, title = ?,
      html_url = ?, is_public = ?, state = ?, draft = ?, review = ?, comment_count = ?,
      checked_at = ?, error = ?, closing_known = ?, closing_json = ?
     WHERE id = ?`,
  );
  const remove = db.prepare(`DELETE FROM github_subjects WHERE id = ?`);
  const insertLink = db.prepare(
    `INSERT INTO research_links (run_id, subject_id, relation, url)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(run_id, subject_id, relation) DO NOTHING`,
  );
  const linksForRun = db.prepare(
    `SELECT run_id, subject_id, relation, url FROM research_links WHERE run_id = ? ORDER BY rowid`,
  );
  const linksFrom = db.prepare(
    `SELECT run_id, subject_id, relation, url FROM research_links WHERE subject_id = ?`,
  );
  const deleteLink = db.prepare(
    `DELETE FROM research_links WHERE run_id = ? AND subject_id = ? AND relation = ?`,
  );
  const insertFact = db.prepare(
    `INSERT INTO github_facts (subject_id, kind, detail, at) VALUES (?, ?, ?, ?)
     ON CONFLICT(subject_id, kind, detail) DO NOTHING`,
  );
  const factsFor = db.prepare(
    `SELECT subject_id, kind, detail, at FROM github_facts WHERE subject_id = ?`,
  );

  function readRow(row: SubjectSql | undefined) {
    return row ? fromSql(row) : null;
  }

  function values(row: SubjectRow) {
    return [
      row.nodeId,
      row.kind,
      row.owner,
      row.repo,
      row.number,
      row.authorLogin,
      row.title,
      row.htmlUrl,
      row.isPublic == null ? null : row.isPublic ? 1 : 0,
      row.state,
      row.draft ? 1 : 0,
      row.review,
      row.commentCount,
      row.checkedAt,
      row.error,
      row.closingKnown ? 1 : 0,
      JSON.stringify(row.closingPrs),
    ];
  }

  function one(id: string) {
    return readRow(byId.get(id) as SubjectSql | undefined);
  }

  function ensure(planned: PlannedLink) {
    const found = readRow(
      byCoord.get(planned.kind, planned.owner, planned.repo, planned.number) as
        | SubjectSql
        | undefined,
    );
    if (found) return found;
    const created = emptySubject(newId(), planned);
    insert.run(
      created.id,
      ...values(created),
    );
    return created;
  }

  function moveLinks(from: string, to: string) {
    const rows = linksFrom.all(from) as {
      run_id: string;
      subject_id: string;
      relation: string;
      url: string;
    }[];
    for (const row of rows) {
      deleteLink.run(row.run_id, from, row.relation);
      insertLink.run(row.run_id, to, row.relation, row.url);
    }
  }

  return {
    bind(run) {
      for (const planned of planBindings(run)) {
        const subject = ensure(planned);
        insertLink.run(run.id, subject.id, planned.relation, planned.url);
      }
    },
    due(runIds, now, pausedUntil) {
      const rows: SubjectRow[] = [];
      const seen = new Set<string>();
      for (const runId of runIds) {
        const links = linksForRun.all(runId) as { subject_id: string }[];
        for (const link of links) {
          if (seen.has(link.subject_id)) continue;
          seen.add(link.subject_id);
          const subject = one(link.subject_id);
          if (subject && shouldRefresh(subject, now, pausedUntil)) rows.push(subject);
        }
      }
      return rows.sort((a, b) => (a.checkedAt ?? -1) - (b.checkedAt ?? -1) || (a.id < b.id ? -1 : 1));
    },
    read: one,
    apply(id, row, nextFacts) {
      const write = () => {
        let target = id;
        if (row.nodeId) {
          const other = readRow(byNode.get(row.nodeId) as SubjectSql | undefined);
          if (other && other.id !== target) {
            moveLinks(target, other.id);
            remove.run(target);
            target = other.id;
          }
        }
        const coord = readRow(
          byCoord.get(row.kind, row.owner, row.repo, row.number) as SubjectSql | undefined,
        );
        if (coord && coord.id !== target) {
          moveLinks(target, coord.id);
          remove.run(target);
          target = coord.id;
        }
        const existing = one(target);
        const stored = { ...row, id: target };
        if (!existing) insert.run(stored.id, ...values(stored));
        else update.run(...values(stored), stored.id);
        for (const fact of nextFacts) insertFact.run(target, fact.kind, fact.detail, fact.at);
      };
      db.exec("BEGIN");
      try {
        write();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    saveClosing(id, prs) {
      db.prepare(
        `UPDATE github_subjects SET closing_known = 1, closing_json = ? WHERE id = ?`,
      ).run(JSON.stringify(prs), id);
    },
    history(runs) {
      const links: LinkRecord[] = [];
      const subjectIds = new Set<string>();
      for (const run of runs) {
        const rows = linksForRun.all(run.id) as {
          run_id: string;
          subject_id: string;
          relation: string;
          url: string;
        }[];
        for (const row of rows) {
          if (row.relation !== "source" && row.relation !== "linked") continue;
          links.push({
            runId: row.run_id,
            subjectId: row.subject_id,
            relation: row.relation,
            url: row.url,
          });
          subjectIds.add(row.subject_id);
        }
      }
      const subjects = [...subjectIds].flatMap((id) => {
        const subject = one(id);
        return subject ? [subject] : [];
      });
      const factRows: FactRecord[] = [];
      for (const id of subjectIds) {
        const rows = factsFor.all(id) as {
          subject_id: string;
          kind: FactKind;
          detail: string;
          at: number;
        }[];
        for (const row of rows) {
          factRows.push({
            subjectId: row.subject_id,
            kind: row.kind,
            detail: row.detail,
            at: row.at,
          });
        }
      }
      return historiesFrom(runs, links, subjects, factRows);
    },
    closingSources(runs) {
      const built = this.history(runs);
      const out: {
        id: string;
        owner: string;
        repo: string;
        number: number;
        closingKnown: boolean;
      }[] = [];
      for (const run of runs) {
        const history = built.get(run.id) ?? emptyHistory();
        const candidate = history.links.some(
          (link) => link.kind === "pull" && link.state === "merged" && link.byResearcher,
        );
        if (!candidate || history.source?.kind !== "issue") continue;
        const rows = linksForRun.all(run.id) as { subject_id: string; relation: string }[];
        const sourceId = rows.find((row) => row.relation === "source")?.subject_id;
        const source = sourceId ? one(sourceId) : null;
        if (!source || source.isPublic === false) continue;
        out.push({
          id: source.id,
          owner: source.owner,
          repo: source.repo,
          number: source.number,
          closingKnown: source.closingKnown,
        });
      }
      return out;
    },
  };
}
