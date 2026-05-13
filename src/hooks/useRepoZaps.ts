/**
 * useRepoZaps — reactive zap totals for a repository.
 *
 * Zaps are kind:9735 receipts with an `a` tag targeting any of the repo's
 * announcement coordinates (kind:30617). The nip34RepoLoader already fetches
 * these from repo relays via the `#a` coord filter, so this hook only reads
 * from the in-memory EventStore.
 *
 * Deduplication: multiple zaps from the same sender are collapsed into a
 * single entry with the cumulative sats total. Invalid zap receipts (missing
 * required fields) are filtered out via `isValidZap`.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import {
  getZapAmount,
  getZapSender,
  isValidZap,
} from "applesauce-common/helpers";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

export interface RepoZapper {
  /** Sender pubkey extracted from the zap request embedded in the receipt. */
  pubkey: string;
  /** Cumulative sats zapped by this sender. */
  totalSats: number;
}

export interface RepoZapsResult {
  /** Total sats zapped across all announcements, all senders. */
  totalSats: number;
  /** Per-sender totals, each pubkey appearing once, sorted descending by sats. */
  zappers: RepoZapper[];
}

/**
 * Subscribe to zap totals for a set of repo announcement coordinates.
 *
 * @param coords - The "30617:<pubkey>:<dtag>" coordinate strings for this repo
 *                 (one per confirmed maintainer). Pass an empty array or
 *                 undefined while the repo is still loading.
 */
export function useRepoZaps(coords: string[] | undefined): RepoZapsResult {
  const store = useEventStore();

  // Stable key so the factory only re-runs when the coord set changes.
  const coordKey = (coords ?? []).slice().sort().join(",");

  const zapEvents = use$(() => {
    const cs = coords ?? [];
    if (cs.length === 0) return undefined;
    const filter = { kinds: [9735], "#a": cs } as Filter;
    return store.timeline([filter]) as unknown as Observable<NostrEvent[]>;
  }, [coordKey, store]);

  return useMemo(() => {
    if (!zapEvents) return { totalSats: 0, zappers: [] };

    // Accumulate sats per sender pubkey.
    const bySender = new Map<string, number>();
    for (const ev of zapEvents) {
      if (!isValidZap(ev)) continue;
      const sender = getZapSender(ev);
      if (!sender) continue;
      const amountSats = Math.floor((getZapAmount(ev) ?? 0) / 1000);
      if (amountSats <= 0) continue;
      bySender.set(sender, (bySender.get(sender) ?? 0) + amountSats);
    }

    const zappers: RepoZapper[] = [...bySender.entries()]
      .map(([pubkey, totalSats]) => ({ pubkey, totalSats }))
      .sort((a, b) => b.totalSats - a.totalSats);

    const totalSats = zappers.reduce((sum, z) => sum + z.totalSats, 0);

    return { totalSats, zappers };
  }, [zapEvents]);
}
