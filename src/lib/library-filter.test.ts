import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasLibraryManifest, isLibraryCatalogNoise } from "./library-filter.ts";

describe("isLibraryCatalogNoise", () => {
  it("drops readme lists and algorithm collections", () => {
    assert.equal(
      isLibraryCatalogNoise({
        name: "javascript-algorithms",
        description: "Algorithms and data structures in JavaScript",
      }),
      true,
    );
    assert.equal(
      isLibraryCatalogNoise({
        name: "awesome-typescript",
        description: "A curated list of TypeScript resources",
        topics: ["awesome"],
      }),
      true,
    );
    assert.equal(
      isLibraryCatalogNoise({
        name: "coding-interview-university",
        description: "A complete computer science study plan",
      }),
      true,
    );
  });

  it("keeps a package", () => {
    assert.equal(
      isLibraryCatalogNoise({
        name: "zod",
        description: "TypeScript-first schema validation",
      }),
      false,
    );
  });
});

describe("hasLibraryManifest", () => {
  it("requires a package manifest, not only a readme", () => {
    assert.equal(hasLibraryManifest(["README.md", "LICENSE", "algorithms"]), false);
    assert.equal(hasLibraryManifest(["README.md", "package.json", "src"]), true);
    assert.equal(hasLibraryManifest(["go.mod"]), true);
  });
});
