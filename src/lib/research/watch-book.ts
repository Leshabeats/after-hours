import type { Pool } from "pg";
import { transaction, type Database } from "../db/postgres.ts";
import {
  coordKey,
  mergeObservation,
  type FetchResult,
  type GithubCoord,
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
  bind(run: WatchRun): Promise<void>;
  due(runIds: readonly string[], now: number, pausedUntil: number): Promise<SubjectRow[]>;
  read(id: string): Promise<SubjectRow | null>;
  apply(id: string, result: FetchResult, at: number): Promise<void>;
  saveClosing(id: string, prs: readonly { number: number; merged: boolean }[]): Promise<void>;
  history(
    runs: readonly { id: string; researcherLogin: string }[],
  ): Promise<Map<string, GithubHistory>>;
  closingSources(runs: readonly { id: string; researcherLogin: string }[]): Promise<
    {
      id: string;
      owner: string;
      repo: string;
      number: number;
      closingKnown: boolean;
    }[]
  >;
  pausedUntil(): Promise<number>;
  pause(until: number): Promise<void>;
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

// Resolve identity and freshness before changing links, facts, or subjects.
function canonicalObservation(
  current: SubjectRow | null | undefined,
  node: SubjectRow | null | undefined,
  coord: SubjectRow | null | undefined,
  nodeId: string,
  at: number,
): SubjectRow | null {
  for (const candidate of [current, node, coord]) {
    if (!candidate) continue;
    if (candidate.checkedAt != null && at < candidate.checkedAt) return null;
    // Coordinates can be reused after a transfer; a known GitHub node is a distinct object.
    if (candidate.nodeId && candidate.nodeId !== nodeId) return null;
  }
  return node ?? coord ?? current ?? null;
}

export function createMemoryWatch(newId: () => string): WatchBook {
  const subjects: SubjectRow[] = [];
  const links: LinkRecord[] = [];
  const facts: FactRecord[] = [];
  let paused = 0;

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
    async pausedUntil() {
      return paused;
    },
    async pause(until) {
      paused = Math.max(paused, until);
    },
    async bind(run) {
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
    async due(runIds, now, pausedUntil) {
      const wanted = new Set(runIds);
      const ids = new Set(
        links.filter((link) => wanted.has(link.runId)).map((link) => link.subjectId),
      );
      return subjects
        .filter((subject) => ids.has(subject.id) && shouldRefresh(subject, now, pausedUntil))
        .sort((a, b) => (a.checkedAt ?? -1) - (b.checkedAt ?? -1) || (a.id < b.id ? -1 : 1))
        .map(cloneSubject);
    },
    async read(id) {
      const row = subjects.find((subject) => subject.id === id);
      return row ? cloneSubject(row) : null;
    },
    async apply(id, result, at) {
      let current = subjects.find((subject) => subject.id === id);
      if (current?.checkedAt != null && at < current.checkedAt) return;
      if (result.type === "ok") {
        const observed = result.observed;
        const node = subjects.find((subject) => subject.nodeId === observed.nodeId);
        const coord = subjects.find((subject) => coordKey(subject) === coordKey(observed));
        const canonical = canonicalObservation(current, node, coord, observed.nodeId, at);
        if (!canonical) return;
        for (const from of new Set([current?.id, coord?.id])) {
          if (!from || from === canonical.id) continue;
          retarget(links, from, canonical.id);
          for (const fact of [...facts]) {
            if (fact.subjectId !== from) continue;
            const duplicate = facts.some(
              (item) =>
                item.subjectId === canonical.id &&
                item.kind === fact.kind &&
                item.detail === fact.detail,
            );
            if (duplicate) facts.splice(facts.indexOf(fact), 1);
            else fact.subjectId = canonical.id;
          }
          const index = subjects.findIndex((subject) => subject.id === from);
          if (index >= 0) subjects.splice(index, 1);
        }
        current = canonical;
      }
      if (!current) return;
      const target = current.id;
      const { row, facts: nextFacts } = mergeObservation(current, result, at);
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
    async saveClosing(id, prs) {
      const row = subjects.find((subject) => subject.id === id);
      if (!row) return;
      row.closingKnown = true;
      row.closingPrs = prs.map((pr) => ({ ...pr }));
    },
    async history(runs) {
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
    async closingSources(runs) {
      const histories = await this.history(runs);
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

const subjectSelect = `SELECT id, node_id AS "nodeId", kind, owner, repo, number,
 author_login AS "authorLogin", title, html_url AS "htmlUrl", is_public AS "isPublic",
 state, draft, review, comment_count AS "commentCount", checked_at AS "checkedAt",
 error, closing_known AS "closingKnown", COALESCE(closing_json,'[]'::jsonb) AS "closingPrs"
 FROM github_subjects`;
const linkSelect = `SELECT run_id AS "runId", subject_id AS "subjectId", relation, url FROM research_links`;

export function createPostgresWatch(pool: Pool, newId: () => string): WatchBook {
  const locked = <T>(work: (db: Database) => Promise<T>) => transaction(pool, "github:watch", work);
  async function one(db: Database, id: string) {
    return (await db.query<SubjectRow>(`${subjectSelect} WHERE id = $1`, [id])).rows[0] ?? null;
  }
  async function byCoord(db: Database, coord: GithubCoord) {
    return (
      (
        await db.query<SubjectRow>(
          `${subjectSelect} WHERE kind = $1 AND lower(owner) = lower($2)
      AND lower(repo) = lower($3) AND number = $4`,
          [coord.kind, coord.owner, coord.repo, coord.number],
        )
      ).rows[0] ?? null
    );
  }
  async function write(db: Database, row: SubjectRow) {
    await db.query(
      `INSERT INTO github_subjects
      (id,node_id,kind,owner,repo,number,author_login,title,html_url,is_public,state,draft,
       review,comment_count,checked_at,error,closing_known,closing_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET node_id = excluded.node_id, kind = excluded.kind,
      owner = excluded.owner, repo = excluded.repo, number = excluded.number,
      author_login = excluded.author_login, title = excluded.title, html_url = excluded.html_url,
      is_public = excluded.is_public, state = excluded.state, draft = excluded.draft,
      review = excluded.review, comment_count = excluded.comment_count, checked_at = excluded.checked_at,
      error = excluded.error, closing_known = excluded.closing_known, closing_json = excluded.closing_json`,
      [
        row.id,
        row.nodeId,
        row.kind,
        row.owner,
        row.repo,
        row.number,
        row.authorLogin,
        row.title,
        row.htmlUrl,
        row.isPublic,
        row.state,
        row.draft,
        row.review,
        row.commentCount,
        row.checkedAt,
        row.error,
        row.closingKnown,
        JSON.stringify(row.closingPrs),
      ],
    );
  }
  async function move(db: Database, from: string, to: string) {
    // Retain original link identities so report-link display order survives deduplication.
    await db.query(
      `DELETE FROM research_links old USING research_links existing
      WHERE old.subject_id = $1 AND existing.subject_id = $2
      AND old.run_id = existing.run_id AND old.relation = existing.relation`,
      [from, to],
    );
    await db.query("UPDATE research_links SET subject_id = $2 WHERE subject_id = $1", [from, to]);
    await db.query(
      `INSERT INTO github_facts (subject_id,kind,detail,at)
      SELECT $2,kind,detail,at FROM github_facts WHERE subject_id = $1 ON CONFLICT DO NOTHING`,
      [from, to],
    );
    await db.query("DELETE FROM github_facts WHERE subject_id = $1", [from]);
    await db.query("DELETE FROM github_subjects WHERE id = $1", [from]);
  }
  async function snapshots(runs: readonly { id: string; researcherLogin: string }[]) {
    return locked(async (db) => {
      const links = (
        await db.query<LinkRecord>(`${linkSelect} WHERE run_id = ANY($1::text[]) ORDER BY id`, [
          runs.map((run) => run.id),
        ])
      ).rows;
      const ids = [...new Set(links.map((link) => link.subjectId))];
      const subjects = (
        await db.query<SubjectRow>(`${subjectSelect} WHERE id = ANY($1::text[])`, [ids])
      ).rows;
      const facts = (
        await db.query<FactRecord>(
          `SELECT subject_id AS "subjectId",kind,detail,at
      FROM github_facts WHERE subject_id = ANY($1::text[])`,
          [ids],
        )
      ).rows;
      return { links, subjects, facts };
    });
  }
  return {
    bind: (run) =>
      locked(async (db) => {
        for (const planned of planBindings(run)) {
          let subject = await byCoord(db, planned);
          if (!subject) {
            subject = emptySubject(newId(), planned);
            await write(db, subject);
          }
          await db.query(
            `INSERT INTO research_links (run_id,subject_id,relation,url)
          VALUES ($1,$2,$3,$4) ON CONFLICT (run_id,subject_id,relation) DO NOTHING`,
            [run.id, subject.id, planned.relation, planned.url],
          );
        }
      }),
    async due(runIds, now, pausedUntil) {
      const rows = (
        await pool.query<SubjectRow>(
          `${subjectSelect} WHERE id IN
        (SELECT subject_id FROM research_links WHERE run_id = ANY($1::text[]))
        ORDER BY checked_at ASC NULLS FIRST, id COLLATE "C" ASC`,
          [runIds],
        )
      ).rows;
      return rows.filter((row) => shouldRefresh(row, now, pausedUntil));
    },
    read: (id) => one(pool, id),
    apply: (id, result, at) =>
      locked(async (db) => {
        let current = await one(db, id);
        if (current?.checkedAt != null && at < current.checkedAt) return;
        if (result.type === "ok") {
          const observed = result.observed;
          const node = (
            await db.query<SubjectRow>(`${subjectSelect} WHERE node_id = $1`, [observed.nodeId])
          ).rows[0];
          const coord = await byCoord(db, observed);
          const canonical = canonicalObservation(current, node, coord, observed.nodeId, at);
          if (!canonical) return;
          for (const duplicate of new Set(
            [current?.id, coord?.id].filter((value): value is string => Boolean(value)),
          )) {
            if (duplicate !== canonical.id) await move(db, duplicate, canonical.id);
          }
          current = canonical;
        }
        if (!current) return;
        const target = current.id;
        const merged = mergeObservation(current, result, at);
        await write(db, { ...merged.row, id: target });
        for (const fact of merged.facts) {
          await db.query(
            `INSERT INTO github_facts (subject_id,kind,detail,at)
          VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [target, fact.kind, fact.detail, fact.at],
          );
        }
      }),
    saveClosing: (id, prs) =>
      locked(async (db) => {
        await db.query(
          "UPDATE github_subjects SET closing_known = TRUE, closing_json = $2 WHERE id = $1",
          [id, JSON.stringify(prs)],
        );
      }),
    async history(runs) {
      const { links, subjects, facts } = await snapshots(runs);
      return historiesFrom(runs, links, subjects, facts);
    },
    async closingSources(runs) {
      const { links, subjects, facts } = await snapshots(runs);
      const histories = historiesFrom(runs, links, subjects, facts);
      return runs.flatMap((run) => {
        const history = histories.get(run.id) ?? emptyHistory();
        if (
          history.source?.kind !== "issue" ||
          !history.links.some(
            (link) => link.kind === "pull" && link.state === "merged" && link.byResearcher,
          )
        )
          return [];
        const sourceId = links.find(
          (link) => link.runId === run.id && link.relation === "source",
        )?.subjectId;
        const source = subjects.find((subject) => subject.id === sourceId);
        return source && source.isPublic !== false
          ? [
              {
                id: source.id,
                owner: source.owner,
                repo: source.repo,
                number: source.number,
                closingKnown: source.closingKnown,
              },
            ]
          : [];
      });
    },
    async pausedUntil() {
      return (
        (
          await pool.query<{ paused_until: number }>(
            "SELECT paused_until FROM github_watch_state WHERE id = 1",
          )
        ).rows[0]?.paused_until ?? 0
      );
    },
    async pause(until) {
      await pool.query(
        "UPDATE github_watch_state SET paused_until = GREATEST(paused_until,$1) WHERE id = 1",
        [until],
      );
    },
  };
}
