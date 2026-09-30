import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogProjects,
  findCatalogRepo,
  libraryPicks,
  parseCatalogSearch,
  parseCategoryId,
} from "./catalog.ts";

describe("parseCatalogSearch", () => {
  it("defaults to web with no language", () => {
    assert.deepEqual(parseCatalogSearch({}), {});
    assert.equal(parseCategoryId(undefined), "web");
  });

  it("treats an old language category as the language ecosystem", () => {
    assert.deepEqual(parseCatalogSearch({ cat: "typescript" }), {
      lang: "TypeScript",
    });
  });
});

describe("catalogProjects", () => {
  it("lists web platform projects, not TypeScript apps", () => {
    const names = catalogProjects("web").map((p) => `${p.owner}/${p.repo}`);
    assert.ok(names.includes("whatwg/html"));
    assert.equal(names.includes("microsoft/TypeScript"), false);
  });

  it("lists the language itself, not libraries written in it", () => {
    const names = catalogProjects("web", "TypeScript").map(
      (p) => `${p.owner}/${p.repo}`,
    );
    assert.deepEqual(names[0], "microsoft/TypeScript");
    assert.equal(names.includes("microsoft/vscode"), false);
    assert.equal(names.includes("colinhacks/zod"), false);
  });

  it("pins the JS and TS libraries we actually use", () => {
    for (const lang of ["TypeScript", "JavaScript"] as const) {
      const names = libraryPicks(lang).map((p) => `${p.owner}/${p.repo}`);
      assert.ok(names.includes("colinhacks/zod"));
      assert.ok(names.includes("prisma/prisma"));
      assert.ok(names.includes("drizzle-team/drizzle-orm"));
      assert.ok(names.includes("npm/cli"));
      assert.ok(names.includes("vitejs/vite"));
      assert.ok(names.includes("pnpm/pnpm"));
      assert.ok(names.includes("typeorm/typeorm"));
      assert.ok(names.includes("pinojs/pino"));
      assert.ok(names.includes("react-hook-form/react-hook-form"));
    }
    assert.equal(libraryPicks("Go").length, 0);
  });

  it("finds the curated note for a known repo", () => {
    assert.equal(findCatalogRepo("microsoft", "TypeScript")?.blurb, "Компилятор и язык");
    assert.equal(findCatalogRepo("NoSuch", "repo"), undefined);
  });

  it("keeps Stars as household projects", () => {
    const names = catalogProjects("stars").map((p) => `${p.owner}/${p.repo}`);
    assert.ok(names.includes("godotengine/godot"));
    assert.ok(names.includes("obsproject/obs-studio"));
  });
});
