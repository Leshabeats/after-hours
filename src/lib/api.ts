import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseCatalogSearch, parseCategoryId, parseLanguageId } from "@/lib/catalog";
import { isDiscoveryWorld } from "@/lib/discovery/types";

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
    if (!isDiscoveryWorld(category)) return shelf;
    const { readWorldDiscovery } = await import("./discovery/read");
    const [projects, discovery] = await Promise.all([shelf, readWorldDiscovery(category)]);
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

export const getFateMissions = createServerFn({ method: "GET" })
  .validator(
    z.object({
      category: z.string().max(40).optional(),
      language: z.string().max(40).optional(),
      tag: z.string().max(40).optional(),
      view: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { findMissions } = await import("./mcp/missions");
    const category = parseCategoryId(data.category);
    const search = parseCatalogSearch({
      cat: category,
      lang: data.language,
      tag: data.tag,
      view: data.view,
    });
    try {
      const issues = await findMissions({
        category,
        language: search.lang,
        tag: search.tag,
        view: search.view,
        limit: 5,
      });
      return { issues, start: Math.floor(Math.random() * issues.length), unavailable: false };
    } catch {
      return { issues: [], start: 0, unavailable: true };
    }
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
