/**
 * Route parsing utilities for repo URLs.
 *
 * Supported formats (all accepted as incoming routes):
 *   /:npub/:repoId
 *   /:npub/:relayHint/:repoId      relay hint has no "://" — wss:// is stripped when generating
 *   /:nip05/:repoId                nip05 = user@domain.com or domain.com
 *   /:nip05/:relayHint/:repoId
 *
 * Generated links prefer:
 *   /:nip05/:relayHint/:repoId     when a verified NIP-05 identity is available
 *   /:npub/:relayHint/:repoId      fallback when no NIP-05 is available
 *
 * Issue / PR / commit identifiers in URLs are nevent1-encoded for shareability.
 * Internally the app always works with raw hex event IDs.
 */

import { nip19 } from "nostr-tools";
import { ensureWebSocketURL } from "applesauce-core/helpers";
import { normalizeUrl } from "@/lib/url";

// ---------------------------------------------------------------------------
// Segment classifiers
// ---------------------------------------------------------------------------

/** Returns true if the string looks like a raw 64-char hex pubkey. */
export function isHexPubkey(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s);
}

/** Returns true if the string is a valid npub1… bech32 public key. */
export function isNpub(s: string): boolean {
  try {
    return nip19.decode(s).type === "npub";
  } catch {
    return false;
  }
}

/**
 * Returns true if the string is any recognised pubkey form:
 * npub1… bech32 or raw 64-char hex.
 */
export function isPubkeyIdentifier(s: string): boolean {
  return isNpub(s) || isHexPubkey(s);
}

/**
 * Decode any pubkey identifier (npub1… or 64-char hex) to a raw hex pubkey.
 * Returns undefined if the string is not a recognised pubkey form.
 */
export function decodePubkeyIdentifier(s: string): string | undefined {
  if (isHexPubkey(s)) return s.toLowerCase();
  try {
    const decoded = nip19.decode(s);
    if (decoded.type === "npub") return decoded.data;
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Returns true if the string looks like a NIP-05 address:
 *   user@domain.com  OR  domain.com  (bare domain → _@domain.com)
 */
export function isNip05(s: string): boolean {
  // Domain: one or more labels (each alphanumeric, hyphens allowed internally,
  // up to 63 chars and not starting/ending with a hyphen) followed by an
  // alphabetic TLD of 2+ chars. Intermediate labels may contain digits
  // (e.g. "goskatespots.nostr1.com").
  const domain =
    "(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,}";
  // Standardised form: user@domain.com
  const emailRegex = new RegExp(`^(?!.*\\.\\.)[A-Za-z0-9._%+-]+@${domain}$`);
  if (emailRegex.test(s)) return true;
  // Bare domain form: domain.com or sub.domain.com
  const domainRegex = new RegExp(`^${domain}$`);
  return domainRegex.test(s);
}

/**
 * Returns true if the segment looks like a relay hint.
 * A relay hint is normally a domain-like string (contains a dot). Localhost
 * relay hints are also valid and essential for local-first development. The
 * slash-free `ws:` form preserves plaintext relay schemes through routing.
 *
 * Note: relay hints are stored without the wss:// prefix in the URL.
 */
export function isRelayHint(s: string): boolean {
  return (
    s.includes(".") ||
    /^localhost(?::\d+)?$/i.test(s) ||
    /^(?:ws|wss):/i.test(s)
  );
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

interface ParsedRelayAndRepoId {
  relayHints: string[];
  repoId: string;
}

/**
 * Extract the optional relay hint and the repository identifier from all
 * segments after an identity. This accepts both raw URL segments and decoded
 * wildcard params for backwards compatibility. RepoLayout parses the raw
 * location pathname so identifiers are decoded exactly once.
 */
function parseRelayAndRepoId(
  segments: string[],
): ParsedRelayAndRepoId | undefined {
  const [first, second] = segments;
  if (!first) return undefined;

  // A decoded legacy ws:// relay is exposed as `ws:`, `host`; reconstruct it
  // before parsing the d-tag.
  if ((first === "ws:" || first === "wss:") && second) {
    const relayHint = normalizeRelayHint(`${first}//${second}`);
    return {
      relayHints: relayHint ? [relayHint] : [],
      repoId: segments.slice(2).join("/"),
    };
  }

  if (segments.length > 1 && isRelayHint(first)) {
    const relayHint = normalizeRelayHint(first);
    return {
      relayHints: relayHint ? [relayHint] : [],
      repoId: segments.slice(1).join("/"),
    };
  }

  return { relayHints: [], repoId: segments.join("/") };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NIP-19 event ID helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the string is a bech32 event identifier (note1 or nevent1).
 */
export function isEventIdentifier(s: string): boolean {
  return s.startsWith("note1") || s.startsWith("nevent1");
}

/**
 * Decode a note1 or nevent1 identifier to a raw hex event ID.
 * Returns undefined if the string is not a valid event identifier.
 */
export function decodeEventIdentifier(s: string): string | undefined {
  try {
    const decoded = nip19.decode(s);
    if (decoded.type === "note") return decoded.data;
    if (decoded.type === "nevent") return decoded.data.id;
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Extract relay hints from a nevent1 identifier.
 * Returns an empty array for note1 or invalid identifiers.
 */
export function relaysFromEventIdentifier(s: string): string[] {
  try {
    const decoded = nip19.decode(s);
    if (decoded.type === "nevent") return decoded.data.relays ?? [];
  } catch {
    // ignore
  }
  return [];
}

/**
 * Encode a raw hex event ID as a nevent1 identifier with optional relay hints.
 * Always uses nevent1 (not note1) so relay hints can be included.
 */
export function eventIdToNevent(id: string, relays?: string[]): string {
  return nip19.neventEncode({
    id,
    relays: relays?.length ? relays : undefined,
  });
}

/** Sub-paths that appear after the repo identifier in the URL. */
const REPO_SUB_PATHS = [
  "issues",
  "prs",
  "pr", // legacy gitworkshop singular form — redirected to /prs/ by LegacyRedirect
  "proposals", // legacy gitworkshop name — redirected to /prs/ by LegacyRedirect
  "about",
  "edit",
  "settings",
  "commits",
  "commit",
  "tree",
  "branches",
  "tags",
  "actions",
];

/**
 * Strip known sub-paths from the end of a splat so the parser only sees the
 * repo-identifying prefix.
 *
 * Examples:
 *   "npub1abc/relay/repo/issues/abc123"          → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo/issues"                 → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo/tree/main/src/foo.ts"   → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo/commit/abc123"          → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo/commits"                → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo/actions"                → "npub1abc/relay/repo"
 *   "npub1abc/relay/repo"                        → "npub1abc/relay/repo"
 */
function stripSubPaths(splat: string): string {
  const segments = splat.split("/").filter(Boolean);
  // Find the index of the first known sub-path keyword and truncate there.
  // This handles deep paths like tree/:ref/:path* correctly.
  for (let i = 0; i < segments.length; i++) {
    if (REPO_SUB_PATHS.includes(segments[i])) {
      return segments.slice(0, i).join("/");
    }
  }
  // No sub-path keyword found — strip a trailing 64-char hex ID or nevent/note identifier
  let end = segments.length;
  const last = segments[end - 1];
  if (end > 0 && (/^[0-9a-f]{64}$/i.test(last) || isEventIdentifier(last))) {
    end--;
  }
  return segments.slice(0, end).join("/");
}

/**
 * Parse a splat path (everything after the leading /) into a repo route.
 *
 * Returns undefined if the path doesn't match any known repo route pattern.
 *
 * Segment layouts:
 *   [npub, ...repoId]
 *   [npub, relayHint, ...repoId]
 *   [nip05, ...repoId]
 *   [nip05, relayHint, ...repoId]
 *
 * Repository identifiers containing `/` are percent-encoded in generated
 * links. React Router may decode those encoded slashes before this parser sees
 * the splat, so all remaining segments belong to the identifier.
 */
export function parseRepoRoute(splat: string): ParsedRepoRoute | undefined {
  // Strip sub-paths (issues, about, issue IDs) before parsing
  const stripped = stripSubPaths(splat);
  // Split BEFORE percent-decoding so that %2F inside a repo identifier (d-tag
  // containing a slash) is not mistaken for a path separator. Decode each
  // segment individually so that relay hints with %3A (colons) still work.
  const segments = stripped
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        // React Router decodes wildcard params twice when a decoded percent
        // sequence is itself a valid escape (for example, `%252F` becomes
        // `/`). repoToPath protects those sequences with an extra `%25`;
        // remove that protection before the single intentional decode here.
        return decodeURIComponent(s.replace(/%2525([0-9A-F]{2})/gi, "%25$1"));
      } catch {
        return s;
      }
    });

  if (segments.length < 2) return undefined;

  const [first] = segments;

  // --- npub / hex-pubkey routes ---
  if (isPubkeyIdentifier(first)) {
    const pubkey = decodePubkeyIdentifier(first)!;
    const parsed = parseRelayAndRepoId(segments.slice(1));
    return parsed && { type: "npub", pubkey, ...parsed };
  }

  // --- nip05 routes ---
  if (isNip05(first)) {
    const nip05 = standardizeNip05(first);
    const parsed = parseRelayAndRepoId(segments.slice(1));
    return parsed && { type: "nip05", nip05, ...parsed };
  }

  return undefined;
}

/**
 * Parse a relay URL from a route segment or user input.
 *
 * Accepts:
 *   - Full URLs:  wss://relay.ngit.dev  ws://relay.ngit.dev
 *   - Hint form:  relay.ngit.dev  (no scheme → wss:// prepended)
 *   - URL-encoded variants of the above
 *
 * Returns the normalised wss:// or ws:// URL, or undefined if invalid.
 */
export function parseRelayUrl(raw: string): string | undefined {
  return normalizeRelayHint(raw);
}

/**
 * Encode a relay URL for use as a route segment.
 * Strips wss:// (the common case) so URLs stay readable.
 * ws:// uses a slash-free `ws:` prefix so React Router's wildcard decoding
 * cannot turn its encoded slashes into extra route segments.
 */
export function relayUrlToSegment(url: string): string {
  const normalized = normalizeUrl(url);
  if (normalized.startsWith("wss://")) return normalized.slice(6);
  // ws:// — encode only the colon. The resulting `ws:host` remains one
  // segment after React Router decodes it.
  return encodeURIComponent(`ws:${normalized.slice(5)}`);
}

/**
 * Normalise a relay hint segment back to a full wss:// URL.
 * The hint is stored without the scheme (wss:// stripped when generating).
 */
function normalizeRelayHint(hint: string): string | undefined {
  try {
    let url = decodeURIComponent(hint);
    if (url.startsWith("ws:") && !url.startsWith("ws://")) {
      url = `ws://${url.slice(3)}`;
    }
    if (!url.includes("://")) url = "wss://" + url;
    return normalizeUrl(ensureWebSocketURL(url));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Link generation
// ---------------------------------------------------------------------------

/**
 * Build the URL-safe identity segment for a pubkey.
 *
 * Prefers a verified NIP-05 address when provided:
 *   - "_@domain.com" → "domain.com"  (bare domain)
 *   - "user@domain.com" → "user@domain.com"
 *
 * Falls back to the npub when no NIP-05 is available.
 */
export function pubkeyToIdentity(pubkey: string, nip05?: string): string {
  if (nip05) {
    return nip05.startsWith("_@") ? nip05.slice(2) : nip05;
  }
  return nip19.npubEncode(pubkey);
}

/**
 * Generate a canonical user profile URL: /:nip05 or /:npub
 *
 * @param pubkey  - hex pubkey
 * @param nip05   - optional verified NIP-05 address (standardised)
 */
export function userToPath(pubkey: string, nip05?: string): string {
  return `/${pubkeyToIdentity(pubkey, nip05)}`;
}

/**
 * Generate a canonical repo URL.
 *
 * Prefers NIP-05 identity when provided (already verified by the caller):
 *   /:nip05/:relayHint/:repoId   (e.g. /fiatjaf.com/relay.damus.io/myrepo)
 *
 * Falls back to npub when no NIP-05 is available:
 *   /:npub/:relayHint/:repoId
 *
 * The relay hint is the first repo relay with wss:// stripped.
 * If no relays are available the relay segment is omitted.
 *
 * @param pubkey  - hex pubkey of the repo maintainer
 * @param repoId  - the repo d-tag identifier
 * @param relays  - relay list (first entry used as hint)
 * @param nip05   - optional verified NIP-05 address (standardised user@domain.com
 *                  or _@domain.com). When provided it is used as the identity
 *                  segment instead of the npub. Strip leading "_@" for bare domains.
 */
export function repoToPath(
  pubkey: string,
  repoId: string,
  relays: string[],
  nip05?: string,
): string {
  const identity = pubkeyToIdentity(pubkey, nip05);

  // Percent-encode the repo identifier so characters like spaces or emoji
  // are safe as URL path segments (NIP-34 §nostr:// clone URL spec). Give a
  // literal percent escape one extra layer of encoding: React Router otherwise
  // decodes `%252F` twice and turns a literal `%2F` in the identifier into `/`.
  const encodedRepoId = encodeURIComponent(repoId).replace(
    /%25([0-9A-F]{2})/gi,
    "%2525$1",
  );

  const relay = relays[0];
  if (relay) {
    return `/${identity}/${relayUrlToSegment(relay)}/${encodedRepoId}`;
  }
  return `/${identity}/${encodedRepoId}`;
}
