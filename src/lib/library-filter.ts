const NOISE =
  /\b(awesome|algorithms?|leetcode|interviews?|cheatsheets?|cheat-sheets?|roadmaps?|tutorials?|courses?|cookbooks?|snippets?|primers?|curated)\b/i;

const NAME_NOISE = /\b(examples?|boilerplates?|templates?|demos?)\b/i;

const NOISE_PHRASE =
  /curated list|list of |collection of |interview questions|coding interview|30 seconds of|build your own|project-based learning|public apis/i;

export function isLibraryCatalogNoise(input: {
  name: string;
  description?: string | null;
  topics?: readonly string[];
}) {
  const topics = (input.topics ?? []).join(" ");
  const text = `${input.description ?? ""} ${topics}`;
  return (
    NOISE.test(input.name) ||
    NAME_NOISE.test(input.name) ||
    NOISE.test(text) ||
    NOISE_PHRASE.test(`${input.name} ${text}`)
  );
}

const MANIFESTS = new Set([
  "package.json",
  "cargo.toml",
  "go.mod",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "gemfile",
  "mix.exs",
  "package.swift",
  "cmakelists.txt",
  "build.zig",
  "shard.yml",
  "dub.json",
  "pubspec.yaml",
]);

export function hasLibraryManifest(fileNames: readonly string[]) {
  return fileNames.some((name) => MANIFESTS.has(name.toLowerCase()));
}
