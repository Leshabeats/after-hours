import { Link } from "@tanstack/react-router";
import { GAME_TAGS, type DiscoveryCard, type DiscoveryLoad } from "@/lib/discovery/types";
import {
  DISCOVERY_BADGES,
  discoveryDate,
  discoveryFreshness,
  growthLabel,
} from "@/lib/discovery/presentation";
import type { ProjectCard as Project } from "@/lib/github-live";

export function ProjectCard({ project }: { project: Project | DiscoveryCard }) {
  return (
    <Link
      to="/r/$owner/$repo"
      params={{ owner: project.owner, repo: project.repo }}
      className="group flex gap-4 rounded-xl bg-surface p-4 shadow-border transition-colors duration-150 hover:bg-elevated"
    >
      <img
        src={project.logoUrl}
        alt=""
        width={48}
        height={48}
        className="size-12 shrink-0 rounded-lg bg-bg object-cover"
      />
      <span className="min-w-0">
        <span className="block font-display text-2xl italic leading-tight text-fg group-hover:text-paper">
          {project.repo}
        </span>
        <span className="mt-1 block font-mono text-xs text-faint">
          {project.owner}
          {project.stars != null ? ` · ${project.stars.toLocaleString("ru-RU")}` : ""}
        </span>
        <span className="mt-2 block text-sm leading-relaxed text-muted">{project.description}</span>
        {"firstSeenAt" in project ? <DiscoveryDetails project={project} /> : null}
      </span>
    </Link>
  );
}

export function DiscoveryStatus({ discovery }: { discovery?: DiscoveryLoad }) {
  return (
    <p className="mt-3 text-sm leading-relaxed text-muted" role="status">
      {discoveryFreshness(discovery)}
    </p>
  );
}

export function DiscoveryDetails({ project }: { project: DiscoveryCard }) {
  const growth = growthLabel(project.growth);
  return (
    <span className="mt-3 block space-y-2">
      <span className="flex flex-wrap gap-2">
        {project.tags.map((tag) => (
          <span key={tag} className="rounded bg-bg px-2 py-1 font-mono text-xs text-muted">
            {GAME_TAGS.find((item) => item.id === tag)?.label ?? tag}
          </span>
        ))}
        {project.badges.map((badge) => (
          <span
            key={badge}
            className="rounded bg-accent/10 px-2 py-1 font-mono text-xs text-accent"
          >
            {DISCOVERY_BADGES[badge]}
          </span>
        ))}
      </span>
      {project.reasons.map((reason, index) => (
        <span key={index} className="block text-xs leading-relaxed text-muted">
          {reason}
        </span>
      ))}
      {growth ? <span className="block font-mono text-xs text-accent">{growth}</span> : null}
      <span className="block font-mono text-xs leading-relaxed text-faint">
        Создан {discoveryDate(project.createdAt)} · Найден {discoveryDate(project.firstSeenAt)}
      </span>
      <span className="block font-mono text-xs text-faint">
        Данные GitHub на {discoveryDate(project.observedAt)} (UTC)
        {project.language ? ` · ${project.language}` : ""}
      </span>
    </span>
  );
}
