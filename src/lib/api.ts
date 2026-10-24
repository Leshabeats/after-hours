import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseCategoryId, parseLanguageId } from "@/lib/catalog";

export const getProjects = createServerFn({ method: "GET" })
  .validator(
    z.object({
      category: z.string().max(40).optional(),
      language: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { loadProjects } = await import("./github-live");
    const category = parseCategoryId(data.category);
    const shelf = loadProjects({
      category,
      language: parseLanguageId(data.language),
    });
    if (category !== "games") return shelf;
    const { readDiscovery } = await import("./discovery/read");
    const [projects, discovery] = await Promise.all([shelf, readDiscovery()]);
    return { ...projects, discovery };
  });

export const getRepoMissions = createServerFn({ method: "GET" })
  .validator(
    z.object({
      owner: z.string().min(1).max(80),
      repo: z.string().min(1).max(120),
    }),
  )
  .handler(async ({ data }) => {
    const { loadRepoMissions } = await import("./github-live");
    return loadRepoMissions(data.owner, data.repo);
  });

export const getMission = createServerFn({ method: "POST" })
  .validator(
    z.object({
      owner: z.string().min(1).max(80),
      repo: z.string().min(1).max(80),
      number: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const { loadMission } = await import("./github-live");
    return loadMission(data.owner, data.repo, data.number);
  });
