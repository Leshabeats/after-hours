import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_STARS,
  curatedRepos,
  hintLanguage,
  issueSearchQuery,
  parseCatalogSearch,
  parseCategoryId,
  repoSearchQuery,
  seedFits,
} from "./catalog.ts";

describe("parseCatalogSearch", () => {
  it("defaults to an empty search, resolved as web", () => {
    assert.deepEqual(parseCatalogSearch({}), {});
    assert.deepEqual(parseCatalogSearch({ cat: "nope", lang: "COBOL" }), {});
    assert.equal(parseCategoryId(undefined), "web");
  });

  it("keeps known category and language", () => {
    assert.deepEqual(parseCatalogSearch({ cat: "linux", lang: "C" }), {
      cat: "linux",
      lang: "C",
    });
  });
});

describe("star criterion", () => {
  it("is one thousand repository stars", () => {
    assert.equal(MIN_STARS, 1000);
  });

  it("searches repos by stars, not every repo in a language", () => {
    assert.equal(
      repoSearchQuery("web"),
      "stars:>=1000 fork:false archived:false language:TypeScript",
    );
    assert.equal(
      repoSearchQuery("go"),
      "stars:>=1000 fork:false archived:false language:Go",
    );
    assert.equal(
      repoSearchQuery("web", "Go"),
      "stars:>=1000 fork:false archived:false language:Go",
    );
    assert.equal(
      repoSearchQuery("linux", "C"),
      "stars:>=1000 fork:false archived:false language:C linux kernel",
    );
  });

  it("looks up issues only inside chosen repos", () => {
    const q = issueSearchQuery(["microsoft/vscode", "golang/go"]);
    assert.equal(
      q,
      "is:open archived:false repo:microsoft/vscode repo:golang/go",
    );
    assert.match(
      issueSearchQuery(["microsoft/vscode"], "Go"),
      /^is:open archived:false language:Go repo:microsoft\/vscode$/,
    );
  });

  it("keeps Stars as a curated household list", () => {
    const repos = curatedRepos("stars") ?? [];
    assert.ok(repos.includes("microsoft/vscode"));
    assert.ok(repos.includes("godotengine/godot"));
    assert.equal(curatedRepos("go"), undefined);
  });
});

describe("hintLanguage", () => {
  it("prefers the language filter, else category language", () => {
    assert.equal(hintLanguage("web"), "TypeScript");
    assert.equal(hintLanguage("web", "Go"), "Go");
    assert.equal(hintLanguage("cpp"), "C++");
    assert.equal(hintLanguage("linux"), "");
    assert.equal(hintLanguage("stars"), "");
  });
});

describe("seedFits", () => {
  it("only backs the web/ts world", () => {
    assert.equal(seedFits("web"), true);
    assert.equal(seedFits("web", "TypeScript"), true);
    assert.equal(seedFits("go"), false);
    assert.equal(seedFits("linux", "C"), false);
  });
});
