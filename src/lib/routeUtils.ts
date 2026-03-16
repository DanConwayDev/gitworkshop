/**
 * Route parsing utilities for repo URLs.
 *
 * Supported formats (all accepted as incoming routes):
 *   /:npub/:repoId
 *   /:npub/:relayHint/:repoId      relay hint has no "://" — wss:// is stripped when generating
 *   /:nip05/:repoId                nip05 = user@domain.com or domain.com
 *   /:nip05/:relayHint/:repoId
 *
 * Generated links always use:
 *   /:npub/:relayHint/:repoId      where relayHint = first repo relay with wss:// stripped
 */

import { nip19 } from "nostr-tools";

// ---------------------------------------------------------------------------
// Segment classifiers
// ---------------------------------------------------------------------------

/** Returns true if the string is a valid npub1… bech32 public key. */
export function isNpub(s: string): boolean {
  try {
    return nip19.decode(s).type === "npub";
  } catch {
    return false;
  }
}

/**
 * Returns true if the string looks like a NIP-05 address:
 *   user@domain.com  OR  domain.com  (bare domain → _@domain.com)
 */
export function isNip05(s: string): boolean {
  // Standardised form: user@domain.com
  const emailRegex =
    /^(?!.*\.\.)([a-zA-Z0-9._%+-]+)@(?!(?:-)[A-Za-z0-9-]{1,63})([A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+)$/;
  if (emailRegex.test(s)) return true;
  // Bare domain form: domain.com or sub.domain.com
  const domainRegex = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+$/;
  return domainRegex.test(s);
}

/**
 * Returns true if the segment looks like a relay hint.
 * A relay hint is a domain-like string (contains a dot) that is NOT a nip05
 * address with a repo identifier following it. We detect it by the presence
 * of a dot in the segment — the same heuristic gitworkshop uses.
 *
 * Note: relay hints are stored without the wss:// prefix in the URL.
 */
export function isRelayHint(s: string): boolean {
  return s.includes(".");
}

/** Normalise a NIP-05 address to the standardised user@domain.com form. */
export function standardizeNip05(nip05: string): string {
  if (!nip05.includes("@")) return `_@${nip05}`;
  return nip05;
}

// ---------------------------------------------------------------------------
// Parsed route types
// ---------------------------------------------------------------------------

export interface RepoRouteNpub {
  type: "npub";
  pubkey: string;
  relayHints: string[];
  repoId: string;
}

export interface RepoRouteNip05 {
  type: "nip05";
  nip05: string; // standardised user@domain.com
  relayHints: string[];
  repoId: string;
}

export type ParsedRepoRoute = RepoRouteNpub | RepoRouteNip05;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Sub-paths that appear after the repo identifier in the URL. */
const REPO_SUB_PATHS = ["issues", "prs", "about"];

/**
 * Strip known sub-paths from the end of a splat so the parser only sees the
 * repo-identifying prefix.
 *
 * Examples:
 *   "npub1abc/relay/repo/issues/abc123" → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo/issues"        → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo"               → "npub1abc/relay/repo"
 */
function stripSubPaths(splat: string): string {
  const segments = splat.split("/").filter(Boolean);
  // Walk backwards and drop known sub-path segments
  let end = segments.length;
  // Drop issue ID (hex, 64 chars) if present
  if (end > 0 && /^[0-9a-f]{64}$/i.test(segments[end - 1])) end--;
  // Drop "issues" or "about"
  if (end > 0 && REPO_SUB_PATHS.includes(segments[end - 1])) end--;
  return segments.slice(0, end).join("/");
}

/**
 * Parse a splat path (everything after the leading /) into a repo route.
 *
 * Returns undefined if the path doesn't match any known repo route pattern.
 *
 * Segment layouts:
 *   [npub, repoId]
 *   [npub, relayHint, repoId]
 *   [nip05, repoId]
 *   [nip05, relayHint, repoId]
 */
export function parseRepoRoute(splat: string): ParsedRepoRoute | undefined {
  // Strip sub-paths (issues, about, issue IDs) before parsing
  const stripped = stripSubPaths(splat);
  // Decode any URL-encoded characters (e.g. %3A%2F%2F → ://)
  const decoded = decodeURIComponent(stripped);
  const segments = decoded.split("/").filter(Boolean);

  if (segments.length < 2 || segments.length > 3) return undefined;

  const [first, second, third] = segments;

  // --- npub routes ---
  if (isNpub(first)) {
    const pubkey = nip19.decode(first).data as string;

    if (segments.length === 2) {
      // /:npub/:repoId
      return { type: "npub", pubkey, relayHints: [], repoId: second };
    }

    // /:npub/:relayHint/:repoId
    // Reconstruct relay URL: add wss:// if no scheme present
    const relayHint = normalizeRelayHint(second);
    return {
      type: "npub",
      pubkey,
      relayHints: relayHint ? [relayHint] : [],
      repoId: third!,
    };
  }

  // --- nip05 routes ---
  if (isNip05(first)) {
    const nip05 = standardizeNip05(first);

    if (segments.length === 2) {
      // /:nip05/:repoId
      return { type: "nip05", nip05, relayHints: [], repoId: second };
    }

    // /:nip05/:relayHint/:repoId
    const relayHint = normalizeRelayHint(second);
    return {
      type: "nip05",
      nip05,
      relayHints: relayHint ? [relayHint] : [],
      repoId: third!,
    };
  }

  return undefined;
}

/**
 * Normalise a relay hint segment back to a full wss:// URL.
 * The hint is stored without the scheme (wss:// stripped when generating).
 */
function normalizeRelayHint(hint: string): string | undefined {
  let url = decodeURIComponent(hint);
  if (!url.includes("://")) url = "wss://" + url;
  // Basic sanity check
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "wss:" || parsed.protocol === "ws:") return url;
  } catch {
    // ignore
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Link generation
// ---------------------------------------------------------------------------

/**
 * Generate a canonical repo URL: /:npub/:relayHint/:repoId
 * The relay hint is the first repo relay with wss:// stripped.
 * If no relays are available, falls back to /:npub/:repoId.
 */
export function repoToPath(
  pubkey: string,
  repoId: string,
  relays: string[],
): string {
  const npub = nip19.npubEncode(pubkey);
  const relay = relays[0];
  if (relay) {
    // Strip scheme — wss://relay.damus.io → relay.damus.io
    const hint = relay.replace(/^wss?:\/\//, "");
    return `/${npub}/${hint}/${repoId}`;
  }
  return `/${npub}/${repoId}`;
}
