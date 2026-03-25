/**
 * Shared shiki highlighter singleton.
 *
 * Lazily creates a single highlighter instance with github-light / github-dark
 * themes and a curated set of languages. Additional languages are loaded on
 * demand via `highlightCode()` — shiki handles this gracefully.
 */

import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
} from "shiki";

// ---------------------------------------------------------------------------
// Language bundle — loaded eagerly with the highlighter so the most common
// languages are available immediately without a second async round-trip.
// ---------------------------------------------------------------------------

const PRELOADED_LANGS: BundledLanguage[] = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "html",
  "css",
  "markdown",
  "python",
  "rust",
  "go",
  "bash",
  "shell",
  "yaml",
  "toml",
  "sql",
  "c",
  "cpp",
  "java",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "nix",
  "dockerfile",
  "makefile",
  "xml",
  "diff",
  "scss",
];

// ---------------------------------------------------------------------------
// File extension → shiki language mapping
// ---------------------------------------------------------------------------

const EXT_TO_LANG: Record<string, BundledLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  h: "c",
  hpp: "cpp",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  nix: "nix",
  dockerfile: "dockerfile",
  makefile: "makefile",
  mk: "makefile",
  lock: "toml",
  env: "bash",
  svelte: "svelte",
  vue: "vue",
  lua: "lua",
  zig: "zig",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  clj: "clojure",
  r: "r",
  dart: "dart",
  tf: "hcl",
  proto: "protobuf",
  graphql: "graphql",
  gql: "graphql",
};

/**
 * Resolve a filename to a shiki BundledLanguage identifier.
 * Returns "text" for unknown extensions (shiki's plain-text grammar).
 */
export function langFromFilename(filename: string): BundledLanguage | "text" {
  // Handle special filenames (Dockerfile, Makefile, etc.)
  const lower = filename.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile."))
    return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "text";
}

// ---------------------------------------------------------------------------
// Singleton highlighter
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Get (or create) the shared shiki Highlighter instance.
 * Safe to call multiple times — only one instance is ever created.
 */
export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: PRELOADED_LANGS,
    });
  }
  return highlighterPromise;
}

// ---------------------------------------------------------------------------
// Token types re-exported for consumers
// ---------------------------------------------------------------------------

export type { ThemedToken } from "shiki";
