import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { includeMailboxes } from "applesauce-core";
import { of } from "rxjs";
import { map } from "rxjs/operators";
import {
  pool,
  liveness,
  nip34EssentialsLoader,
  nip34CommentsLoader,
  nip34ThreadLoader,
} from "@/services/nostr";

/** Max healthy inbox relays to take for the issue author. */
const MAX_INBOX_RELAYS = 3;

export interface Nip34LoaderOptions {
  /** When true, also fetches from the NIP-65 inbox relays of the item author.
   *  Only the relays not already present in repoRelayGroup are queried —
   *  if all inbox relays overlap with the group, no extra requests are made.
   *  The group's live subscription is extended reactively via group.add() so
   *  late-arriving kind:10002 events are handled automatically. */
  nip65?: boolean;
}

/**
 * Flatten a liveness-filtered list of ProfilePointers into a deduplicated
 * relay URL array, capped at MAX_INBOX_RELAYS per pointer.
 *
 * Already-connected relays (liveness.online) are sorted to the front so we
 * reuse open connections before opening new ones.
 *
 * @param enriched - ProfilePointers with relays already filtered by liveness
 * @param exclude  - Relay URLs already covered (e.g. repo relay group URLs)
 */
function flattenInboxRelays(
  enriched: { pubkey: string; relays?: string[] }[],
  exclude: ReadonlySet<string>,
): string[] {
  const online = new Set(liveness.online);
  const seen = new Set<string>(exclude);
  const result: string[] = [];
  for (const pointer of enriched) {
    const relays = (pointer.relays ?? []).slice().sort((a, b) => {
      return (online.has(a) ? 0 : 1) - (online.has(b) ? 0 : 1);
    });
    let count = 0;
    for (const relay of relays) {
      if (count >= MAX_INBOX_RELAYS) break;
      if (!seen.has(relay)) {
        seen.add(relay);
        result.push(relay);
      }
      count++;
    }
  }
  return result;
}

/**
 * Reactively resolve the NIP-65 inbox relays for a single pubkey that are
 * NOT already present in the repo relay group (the delta).
 *
 * Returns [] when disabled or when all inbox relays overlap with the group.
 * Re-emits when the kind:10002 event arrives late — the dep on the store's
 * replaceable model means any arriving kind:10002 causes a re-emission.
 */
function useInboxOnlyRelays(
  pubkey: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  enabled: boolean,
): string[] {
  const store = useEventStore();

  // Stable key for the group's current relay set — changes when group grows.
  // We snapshot it here; the group may grow later (that's fine — the loader
  // for repo relays already fired, and the group.subscription() in useIssues
  // handles live events reactively via reverseSwitchMap + WeakMap cache).
  const groupRelaySet = new Set(repoRelayGroup?.relays.map((r) => r.url) ?? []);
  const groupRelayKey = [...groupRelaySet].sort().join(",");

  const inboxOnlyRelays = use$(() => {
    if (!enabled || !pubkey) return of([] as string[]);
    return of([{ pubkey }]).pipe(
      includeMailboxes(store, "inbox"),
      ignoreUnhealthyRelaysOnPointers(liveness),
      map((enriched) => flattenInboxRelays(enriched, groupRelaySet)),
    );
  }, [pubkey, groupRelayKey, enabled, store]);

  return inboxOnlyRelays ?? [];
}

/**
 * Triggers two-tier loading for a NIP-34 item (issue, patch, or PR).
 *
 * Call this once per item rendered in a list or on a detail page. All calls
 * within the same render cycle are batched by the loaders into as few relay
 * subscriptions as possible — one per loader instance, not one per item.
 *
 * Tier 1 — essentials (~100ms buffer, fires first):
 *   { kinds: [1630,1631,1632,1633,1985,5], "#e": [all ids] }
 *   Covers status, NIP-32 labels, and deletion requests.
 *
 * Tier 2 — thread (~500ms buffer, fires after essentials):
 *   - { kinds: [1111], "#E": [all ids] }  — NIP-22 comments (uppercase E)
 *   - { kinds: [7, 9735], "#e": [all ids] } — reactions and zaps
 *
 * Events are written directly into the global EventStore by the loaders.
 * Read them back reactively with store.timeline() / use$.
 *
 * NIP-65 mode (options.nip65 = true):
 *   Also fetches from the NIP-65 inbox relays of the item author. Only the
 *   relays NOT already in repoRelayGroup are queried — if all inbox relays
 *   overlap with the group, no extra requests are made. The inbox relay delta
 *   is computed reactively so a late-arriving kind:10002 triggers a second
 *   loader pass for only the new relays.
 *
 *   The repo relay loaders (tier 1 + tier 2) fire once keyed on repoRelayKey
 *   and do NOT re-fire when inbox relays arrive — they are separate use$
 *   blocks with separate dep keys.
 *
 * @param itemId         - The event ID of the issue / patch / PR
 * @param repoRelayGroup - The repo's long-lived RelayGroup (from useResolvedRepository)
 * @param options        - Loader options (nip65)
 */
export function useNip34Loaders(
  itemId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  options?: Nip34LoaderOptions,
): void {
  const store = useEventStore();

  // ── Repo relay loaders ────────────────────────────────────────────────────
  // Keyed on repoRelayKey — stable after initial group build. Does NOT
  // re-fire when inbox relays arrive (separate dep key below).
  const repoRelays = repoRelayGroup?.relays.map((r) => r.url) ?? [];
  const repoRelayKey = repoRelays.join(",");

  // Tier 1 — essentials
  use$(() => {
    if (!itemId) return undefined;
    return nip34EssentialsLoader({ value: itemId, relays: repoRelays });
  }, [itemId, repoRelayKey]);

  // Tier 2 — comments
  use$(() => {
    if (!itemId) return undefined;
    return nip34CommentsLoader({ value: itemId, relays: repoRelays });
  }, [itemId, repoRelayKey]);

  // Tier 2 — reactions + zaps
  use$(() => {
    if (!itemId) return undefined;
    return nip34ThreadLoader({ value: itemId, relays: repoRelays });
  }, [itemId, repoRelayKey]);

  // ── NIP-65 inbox relay loaders ────────────────────────────────────────────
  // Reactively resolve the item author pubkey from the store.
  // Available as soon as the item event lands in the store.
  const authorPubkey = use$(() => {
    if (!itemId || !options?.nip65) return of(undefined);
    return store.event(itemId).pipe(map((ev) => ev?.pubkey));
  }, [itemId, options?.nip65, store]);

  // Delta: inbox relays not already covered by the repo relay group.
  // Returns [] when nip65 is false, pubkey unknown, or full overlap.
  const inboxOnlyRelays = useInboxOnlyRelays(
    authorPubkey,
    repoRelayGroup,
    options?.nip65 ?? false,
  );

  // Add inbox-only relays to the group so the live group.subscription() in
  // useIssues picks them up reactively (reverseSwitchMap + WeakMap cache
  // opens a subscription only to the new relay, existing ones untouched).
  useMemo(() => {
    if (!repoRelayGroup) return;
    for (const url of inboxOnlyRelays) {
      const relay = pool.relay(url);
      if (!repoRelayGroup.has(relay)) repoRelayGroup.add(relay);
    }
  }, [repoRelayGroup, inboxOnlyRelays.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps -- join() is the stable key for the array

  // Fire loaders for inbox-only relays — separate dep key from repo relays
  // so repo relay loaders are never re-triggered by inbox relay arrival.
  // Skipped entirely when inboxOnlyRelays is empty (full overlap case).
  const inboxOnlyKey = inboxOnlyRelays.join(",");

  // Tier 1 — essentials on inbox-only relays
  use$(() => {
    if (!itemId || inboxOnlyRelays.length === 0) return undefined;
    return nip34EssentialsLoader({ value: itemId, relays: inboxOnlyRelays });
  }, [itemId, inboxOnlyKey]);

  // Tier 2 — comments on inbox-only relays
  use$(() => {
    if (!itemId || inboxOnlyRelays.length === 0) return undefined;
    return nip34CommentsLoader({ value: itemId, relays: inboxOnlyRelays });
  }, [itemId, inboxOnlyKey]);

  // Tier 2 — reactions + zaps on inbox-only relays
  use$(() => {
    if (!itemId || inboxOnlyRelays.length === 0) return undefined;
    return nip34ThreadLoader({ value: itemId, relays: inboxOnlyRelays });
  }, [itemId, inboxOnlyKey]);
}
