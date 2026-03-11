/**
 * NIP-34 Git Stuff - Constants and helpers
 */

import type { NostrEvent } from "nostr-tools";

/** Repository announcement (addressable, kind 30617) */
export const REPO_KIND = 30617;

/** Git issue (kind 1621) */
export const ISSUE_KIND = 1621;

/** NIP-22 comment (kind 1111) */
export const COMMENT_KIND = 1111;

/** Status kinds */
export const STATUS_OPEN = 1630;
export const STATUS_RESOLVED = 1631;
export const STATUS_CLOSED = 1632;
export const STATUS_DRAFT = 1633;

export const STATUS_KINDS = [
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
] as const;

export type IssueStatus = "open" | "resolved" | "closed" | "draft";

export function kindToStatus(kind: number): IssueStatus {
  switch (kind) {
    case STATUS_OPEN:
      return "open";
    case STATUS_RESOLVED:
      return "resolved";
    case STATUS_CLOSED:
      return "closed";
    case STATUS_DRAFT:
      return "draft";
    default:
      return "open";
  }
}

/** The single relay we use for NIP-34 */
export const NGIT_RELAY = "wss://relay.ngit.dev";
export const NGIT_RELAYS = [NGIT_RELAY];

/**
 * Build an naddr-style coordinate string for a repo.
 * Format: "30617:<pubkey>:<d-tag>"
 */
export function repoCoordinate(pubkey: string, dTag: string): string {
  return `${REPO_KIND}:${pubkey}:${dTag}`;
}

// ---------------------------------------------------------------------------
// ResolvedRepo — the merged view of a multi-maintainer repository
// ---------------------------------------------------------------------------

/** Provenance record: which maintainer contributed a value and when */
export interface FieldProvenance {
  pubkey: string;
  createdAt: number;
  value: string;
}

/** An edge in the maintainer graph: `from` listed `to` as a maintainer */
export interface MaintainerEdge {
  from: string;
  to: string;
}

/**
 * The fully-resolved view of a repository after BFS chain resolution.
 *
 * Display fields (name, description, webUrls) use latest-wins across all
 * maintainer announcements. Infrastructure fields (cloneUrls, relays) are
 * unioned. The raw announcements and provenance data are preserved for the
 * detailed maintainership graph view.
 */
export interface ResolvedRepo {
  // --- Identity ---
  /** The pubkey used as the starting point for resolution (route anchor) */
  trustedMaintainer: string;
  /** The d-tag identifier shared by all announcements in this repo */
  dTag: string;

  // --- Merged display fields (latest-wins) ---
  name: string;
  description: string;
  /** Web URLs from the single latest announcement */
  webUrls: string[];
  /** Timestamp of the latest announcement (for display) */
  updatedAt: number;

  // --- Unioned infrastructure fields ---
  /** All clone URLs across all maintainer announcements, deduplicated */
  cloneUrls: string[];
  /** All relay URLs across all maintainer announcements, deduplicated */
  relays: string[];

  // --- Maintainer set ---
  /** All pubkeys in the transitive closure reachable from trustedMaintainer */
  maintainerSet: string[];
  /**
   * "30617:<pubkey>:<dTag>" for every maintainer — used for #a tag queries
   * on issues, PRs, and patches.
   */
  allCoordinates: string[];
  /** Pubkeys listed as maintainers but who haven't published their own announcement */
  pendingMaintainers: string[];
  /** Union of `t` tags across all announcements (excluding "personal-fork") */
  labels: string[];

  // --- Graph / provenance data (for detailed view) ---
  /** Raw announcement events, one per maintainer that has published one */
  announcements: NostrEvent[];
  /** Directed edges: who listed whom in their maintainers tag */
  maintainerEdges: MaintainerEdge[];
  /** Per-URL provenance for clone URLs */
  cloneUrlProvenance: FieldProvenance[];
  /** Per-URL provenance for relay URLs */
  relayProvenance: FieldProvenance[];
  /** Which announcement's name won (latest created_at) */
  nameSource: FieldProvenance;
  /** Which announcement's description won */
  descriptionSource: FieldProvenance;
}

// ---------------------------------------------------------------------------
// BFS chain resolution
// ---------------------------------------------------------------------------

/**
 * Given a set of 30617 announcement events already in memory, resolve the
 * transitive maintainer chain starting from `trustedMaintainer` for a given
 * `dTag`. Returns a `ResolvedRepo` or `undefined` if the trusted maintainer
 * has no announcement for this dTag.
 *
 * This is a pure function — no side effects, no relay fetches. Both
 * RepositoryListModel (bulk) and RepositoryModel (single) use this.
 */
export function resolveChain(
  events: NostrEvent[],
  trustedMaintainer: string,
  dTag: string,
): ResolvedRepo | undefined {
  // Index all announcements for this dTag by pubkey for O(1) lookup
  const byPubkey = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== REPO_KIND) continue;
    const d = ev.tags.find(([t]) => t === "d")?.[1];
    if (d !== dTag) continue;
    const existing = byPubkey.get(ev.pubkey);
    // Keep only the latest announcement per pubkey (store handles this but
    // be defensive in case we receive multiple)
    if (!existing || ev.created_at > existing.created_at) {
      byPubkey.set(ev.pubkey, ev);
    }
  }

  // The trusted maintainer must have an announcement to anchor the chain
  if (!byPubkey.has(trustedMaintainer)) return undefined;

  // BFS over the maintainer graph
  const visited = new Set<string>();
  const queue: string[] = [trustedMaintainer];
  const edges: MaintainerEdge[] = [];
  const pending: string[] = [];

  while (queue.length > 0) {
    const pubkey = queue.shift()!;
    if (visited.has(pubkey)) continue;
    visited.add(pubkey);

    const ev = byPubkey.get(pubkey);
    if (!ev) {
      // Listed as maintainer but no announcement yet
      pending.push(pubkey);
      continue;
    }

    // Read maintainers tag — format: ["maintainers", pubkey1, pubkey2, ...]
    const maintainersTag = ev.tags.find(([t]) => t === "maintainers");
    const listed = maintainersTag ? maintainersTag.slice(1) : [];

    for (const listed_pubkey of listed) {
      edges.push({ from: pubkey, to: listed_pubkey });
      if (!visited.has(listed_pubkey)) {
        queue.push(listed_pubkey);
      }
    }
  }

  // Collect all announcements for visited pubkeys (excluding pending)
  const announcements: NostrEvent[] = [];
  for (const pubkey of visited) {
    const ev = byPubkey.get(pubkey);
    if (ev) announcements.push(ev);
  }

  // --- Merge fields ---

  // Latest-wins: name, description, webUrls
  let latestEv = announcements[0];
  for (const ev of announcements) {
    if (ev.created_at > latestEv.created_at) latestEv = ev;
  }

  const getName = (ev: NostrEvent) =>
    ev.tags.find(([t]) => t === "name")?.[1] ??
    ev.tags.find(([t]) => t === "d")?.[1] ??
    "";
  const getDescription = (ev: NostrEvent) =>
    ev.tags.find(([t]) => t === "description")?.[1] ?? ev.content ?? "";
  const getWebUrls = (ev: NostrEvent) =>
    ev.tags.filter(([t]) => t === "web").map(([, v]) => v);

  // Find the latest announcement that actually has a name/description
  // (fall back to overall latest if none have it)
  const nameSource = announcements.reduce(
    (best, ev) => {
      const val = getName(ev);
      if (!val) return best;
      return ev.created_at > best.createdAt
        ? { pubkey: ev.pubkey, createdAt: ev.created_at, value: val }
        : best;
    },
    { pubkey: latestEv.pubkey, createdAt: 0, value: getName(latestEv) },
  );

  const descriptionSource = announcements.reduce(
    (best, ev) => {
      const val = getDescription(ev);
      return ev.created_at > best.createdAt
        ? { pubkey: ev.pubkey, createdAt: ev.created_at, value: val }
        : best;
    },
    {
      pubkey: latestEv.pubkey,
      createdAt: 0,
      value: getDescription(latestEv),
    },
  );

  // Union: clone URLs and relays with provenance
  const cloneUrlProvenance: FieldProvenance[] = [];
  const relayProvenance: FieldProvenance[] = [];
  const seenClone = new Set<string>();
  const seenRelay = new Set<string>();
  const seenLabel = new Set<string>();
  const labels: string[] = [];

  for (const ev of announcements) {
    for (const [t, v] of ev.tags) {
      if (t === "clone" && v && !seenClone.has(v)) {
        seenClone.add(v);
        cloneUrlProvenance.push({
          pubkey: ev.pubkey,
          createdAt: ev.created_at,
          value: v,
        });
      }
      if (t === "relays" && v && !seenRelay.has(v)) {
        seenRelay.add(v);
        relayProvenance.push({
          pubkey: ev.pubkey,
          createdAt: ev.created_at,
          value: v,
        });
      }
      if (t === "t" && v && v !== "personal-fork" && !seenLabel.has(v)) {
        seenLabel.add(v);
        labels.push(v);
      }
    }
  }

  const maintainerSet = Array.from(visited);

  return {
    trustedMaintainer,
    dTag,
    name: nameSource.value || dTag,
    description: descriptionSource.value,
    webUrls: getWebUrls(latestEv),
    updatedAt: latestEv.created_at,
    cloneUrls: cloneUrlProvenance.map((p) => p.value),
    relays: relayProvenance.map((p) => p.value),
    maintainerSet,
    allCoordinates: maintainerSet.map((pk) => repoCoordinate(pk, dTag)),
    pendingMaintainers: pending,
    labels,
    announcements,
    maintainerEdges: edges,
    cloneUrlProvenance,
    relayProvenance,
    nameSource,
    descriptionSource,
  };
}

/**
 * Given all 30617 events in the store, group them into resolved repositories.
 * Each connected component (by mutual maintainer listing) becomes one entry.
 * Only repos reachable from `trustedMaintainer` are included.
 *
 * For repos where the trusted maintainer is NOT in the chain, we pick a
 * random maintainer from the connected component as the route anchor
 * (trustedMaintainer field). This will be refined later (e.g. prefer followed
 * users).
 */
export function groupIntoResolvedRepos(events: NostrEvent[]): ResolvedRepo[] {
  // Collect all distinct dTags
  const dTags = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== REPO_KIND) continue;
    const d = ev.tags.find(([t]) => t === "d")?.[1];
    if (d) dTags.add(d);
  }

  const results: ResolvedRepo[] = [];
  const processedComponents = new Set<string>(); // "pubkey:dTag" keys already in a result

  for (const dTag of dTags) {
    // Collect all pubkeys that have an announcement for this dTag
    const pubkeysForDTag: string[] = [];
    for (const ev of events) {
      if (ev.kind !== REPO_KIND) continue;
      const d = ev.tags.find(([t]) => t === "d")?.[1];
      if (d === dTag) pubkeysForDTag.push(ev.pubkey);
    }

    for (const startPubkey of pubkeysForDTag) {
      const componentKey = `${startPubkey}:${dTag}`;
      if (processedComponents.has(componentKey)) continue;

      const resolved = resolveChain(events, startPubkey, dTag);
      if (!resolved) continue;

      // Mark all members of this component as processed
      for (const pk of resolved.maintainerSet) {
        processedComponents.add(`${pk}:${dTag}`);
      }

      results.push(resolved);
    }
  }

  // Sort by updatedAt descending
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return results;
}
