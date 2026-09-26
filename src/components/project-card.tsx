import { Link } from "@tanstack/react-router";
import type { ProjectCard as Project } from "@/lib/github-live";

export function ProjectCard({ project }: { project: Project }) {
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
        <span className="mt-2 block text-sm leading-relaxed text-muted">
          {project.description}
        </span>
      </span>
    </Link>
  );
}
