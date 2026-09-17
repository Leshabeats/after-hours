import { Link } from "@tanstack/react-router";
import { KIND_META, relativeTime, type Mission } from "@/lib/kinds";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function MissionCard({
  mission,
  className,
}: {
  mission: Mission;
  className?: string;
}) {
  const meta = KIND_META[mission.kind];

  return (
    <Link
      to="/m/$owner/$repo/$number"
      params={{
        owner: mission.owner,
        repo: mission.repo,
        number: String(mission.number),
      }}
      className={cn(
        "group block rounded-lg bg-surface p-4 shadow-border transition-[box-shadow,transform] duration-150 ease-out hover:shadow-border-hover active:scale-[0.99]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-caps text-accent">
          {meta.track}
        </p>
        <span className="font-mono text-xs tabular-nums text-faint">
          {relativeTime(mission.updatedAt)}
        </span>
      </div>
      <p className="mt-3 font-mono text-xs text-muted">
        {mission.owner}/{mission.repo}
        <span className="text-faint">
          {" "}
          {mission.isPr ? "PR" : "#"}
          {mission.number}
        </span>
        {mission.language ? (
          <span className="text-faint"> · {mission.language}</span>
        ) : null}
      </p>
      <h3 className="mt-2 font-display text-xl leading-snug text-fg group-hover:text-paper">
        {mission.title}
      </h3>
      {mission.excerpt ? (
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">
          {mission.excerpt}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge>{meta.label}</Badge>
        {mission.labels.slice(0, 2).map((label) => (
          <Badge key={label}>{label}</Badge>
        ))}
      </div>
    </Link>
  );
}
