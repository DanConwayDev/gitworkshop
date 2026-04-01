/**
 * RepoBadge — a compact rounded badge identifying a git repository.
 *
 * Renders as a link to the repo page showing:
 *   [avatar] username / repo-name
 *
 * The repo name is the primary piece of information (semibold); the username
 * is secondary (muted). The whole badge links to the repo.
 *
 * The repo name is resolved reactively from the EventStore; while loading it
 * falls back to the d-tag identifier so the badge is always meaningful
 * immediately.
 *
 * Props
 * ─────
 * coord        Required. A NIP-34 coordinate string: "30617:<pubkey>:<d-tag>".
 *              The pubkey drives the avatar and username; the d-tag is the
 *              initial repo name fallback.
 *
 * repoName     Optional pre-resolved name. When provided the EventStore lookup
 *              is skipped entirely — useful when the caller already holds a
 *              ResolvedRepo or has the name from another source.
 *
 * className    Extra classes forwarded to the outer element.
 *
 * Efficiency
 * ──────────
 * • Parsing the coord is O(1).
 * • When repoName is supplied no reactive subscription is created.
 * • When repoName is absent a single store.timeline() subscription is used
 *   (cheap: single-kind + single-author + single-d-tag filter).
 * • Avatar and username share the same profile lookup via UserAvatar/UserName.
 */

import { Link } from "react-router-dom";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { getRepoName, REPO_KIND } from "@/lib/nip34";
import { cn } from "@/lib/utils";
import { nip19 } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import { map } from "rxjs/operators";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a NIP-34 coordinate string into its components.
 * Returns undefined when the string is malformed.
 */
function parseCoord(
  coord: string,
): { pubkey: string; dTag: string } | undefined {
  // Format: "30617:<pubkey>:<d-tag>"  (d-tag may itself contain colons)
  const firstColon = coord.indexOf(":");
  if (firstColon === -1) return undefined;
  const secondColon = coord.indexOf(":", firstColon + 1);
  if (secondColon === -1) return undefined;

  const pubkey = coord.slice(firstColon + 1, secondColon);
  const dTag = coord.slice(secondColon + 1);

  if (!/^[0-9a-f]{64}$/.test(pubkey) || !dTag) return undefined;
  return { pubkey, dTag };
}

// ---------------------------------------------------------------------------
// Hook — resolves repo name from the EventStore
// ---------------------------------------------------------------------------

/**
 * Reactively resolves the repo name for a given coordinate.
 * Returns the d-tag immediately (as a fallback) and updates to the event's
 * "name" tag once the kind:30617 event is in the store.
 *
 * When `knownName` is provided the hook returns it immediately without
 * subscribing to the store.
 */
function useRepoName(pubkey: string, dTag: string, knownName?: string): string {
  const store = useEventStore();

  const resolved = use$(() => {
    // Fast path: caller already knows the name — no subscription needed.
    if (knownName !== undefined) return undefined;

    const filter = {
      kinds: [REPO_KIND],
      authors: [pubkey],
      "#d": [dTag],
      limit: 1,
    } as Filter;

    return store
      .timeline([filter])
      .pipe(
        map((events) =>
          events.length > 0 ? getRepoName(events[0]) || dTag : undefined,
        ),
      );
  }, [pubkey, dTag, knownName, store]);

  if (knownName !== undefined) return knownName;
  return resolved ?? dTag;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RepoBadgeProps {
  /**
   * NIP-34 coordinate string: "30617:<pubkey>:<d-tag>".
   * The pubkey drives the avatar; the d-tag is the initial display name.
   */
  coord: string;

  /**
   * Pre-resolved repo name. When provided the EventStore lookup is skipped.
   * Useful when the caller already holds a ResolvedRepo or similar.
   */
  repoName?: string;

  /** Extra classes forwarded to the outer <span>. */
  className?: string;
}

/**
 * Compact rounded badge showing a repo's maintainer avatar and name.
 *
 * ```tsx
 * // From a raw coordinate tag value:
 * <RepoBadge coord="30617:<pubkey>:<d-tag>" />
 *
 * // With a pre-resolved name (skips store lookup):
 * <RepoBadge coord={repo.allCoordinates[0]} repoName={repo.name} />
 * ```
 */
export function RepoBadge({ coord, repoName, className }: RepoBadgeProps) {
  const parsed = parseCoord(coord);

  // Graceful fallback for malformed coords — show the raw string.
  if (!parsed) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground",
          className,
        )}
      >
        <span className="text-muted-foreground font-normal">{coord}</span>
      </span>
    );
  }

  return (
    <RepoBadgeInner
      pubkey={parsed.pubkey}
      dTag={parsed.dTag}
      repoName={repoName}
      className={className}
    />
  );
}

/** Inner component — only rendered when the coord is valid. */
function RepoBadgeInner({
  pubkey,
  dTag,
  repoName,
  className,
}: {
  pubkey: string;
  dTag: string;
  repoName?: string;
  className?: string;
}) {
  const name = useRepoName(pubkey, dTag, repoName);
  const npub = nip19.npubEncode(pubkey);
  const repoPath = `/${npub}/${dTag}`;

  return (
    <Link
      to={repoPath}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground hover:bg-secondary/80 transition-colors",
        className,
      )}
    >
      <UserAvatar
        pubkey={pubkey}
        size="xs"
        className="h-3.5 w-3.5 shrink-0"
        showFollowIndicator={false}
      />
      <UserName
        pubkey={pubkey}
        className="text-xs text-muted-foreground font-normal"
      />
      <span className="text-muted-foreground/40 font-normal">/</span>
      <span className="font-medium">{name}</span>
    </Link>
  );
}
