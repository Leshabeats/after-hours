import { missionId, parseGithubRef } from "../kinds.ts";
import { researchDeliverySchema, type ResearchDeliveryInput } from "./schema.ts";
import type { ResearchRepo } from "./store.ts";
import { emptyUsage, type ResearchRun, type ResearchTurn } from "./types.ts";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function invalid() {
  return Response.json({ ok: false, error: "invalid" }, { status: 400 });
}

function turnsFrom(input: ResearchDeliveryInput, at: number): ResearchTurn[] | null {
  const turns = input.turns ?? [];
  const seen = new Set<string>();
  const next: ResearchTurn[] = [];
  for (const turn of turns) {
    if (seen.has(turn.turnId)) return null;
    seen.add(turn.turnId);
    next.push({
      turnId: turn.turnId,
      status: turn.status,
      usageKnown: turn.usage != null,
      usage: turn.usage ?? emptyUsage(),
      updatedAt: at,
    });
  }
  return next;
}

function runBody(run: ResearchRun) {
  return {
    id: run.id,
    missionId: run.missionId,
    owner: run.owner,
    repo: run.repo,
    number: run.number,
    isPr: run.isPr,
    threadId: run.threadId,
    status: run.status,
    model: run.model,
    report: run.report,
    publishedAt: run.publishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    turns: run.turns.map((turn) => ({
      turnId: turn.turnId,
      status: turn.status,
      usageKnown: turn.usageKnown,
      usage: turn.usage,
    })),
  };
}

function acceptBody(
  body: unknown,
  grant: { userId: string; grantId: string },
  repo: ResearchRepo,
  now: number,
) {
  const parsed = researchDeliverySchema.safeParse(body);
  if (!parsed.success) return invalid();

  const ref = parseGithubRef(parsed.data.missionId);
  if (!ref || ref.number < 1) return invalid();

  const turns = turnsFrom(parsed.data, now);
  if (!turns) return invalid();
  if (parsed.data.status === "completed" && !parsed.data.report) return invalid();

  repo.markUsed(grant.grantId, now);
  const result = repo.ingest(grant.userId, {
    threadId: parsed.data.threadId,
    missionId: missionId(ref.owner, ref.repo, ref.number),
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    isPr: parsed.data.isPr,
    status: parsed.data.status,
    model: parsed.data.model,
    report: parsed.data.report,
    turns,
    limit: parsed.data.limit ?? null,
    at: now,
  });

  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : result.error === "conflict" ? 409 : 400;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({
    ok: true,
    replay: result.replay,
    run: runBody(result.run),
  });
}

export async function handleResearchPost(
  request: Request,
  repo: ResearchRepo,
  now = Date.now(),
) {
  const token = bearerToken(request);
  const grant = token ? repo.authenticate(token) : null;
  if (!grant) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  return acceptBody(body, grant, repo, now);
}
