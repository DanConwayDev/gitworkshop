/**
 * Pure helpers for the NIP-57 zap flow:
 *   - resolving a recipient's lightning address from their kind:0 profile,
 *   - fetching the LNURL pay endpoint and invoice,
 *   - signing the zap request event,
 *   - picking which relays to put in the zap request `relays` tag.
 *
 * No React, no global state — everything is passed in by the caller.
 */
import type { NostrEvent } from "nostr-tools";
import { ZapRequestFactory } from "applesauce-common/factories";
import { parseLNURLOrAddress } from "applesauce-common/helpers";
import type { ISigner } from "applesauce-signers";

/** Subset of a kind:0 profile that we read lightning info from. */
export interface LightningProfile {
  lud16?: string | null;
  lud06?: string | null;
}

export interface LNURLPayEndpoint {
  callback: string;
  minSendable: number;
  maxSendable: number;
  allowsNostr: boolean;
  nostrPubkey?: string;
}

/** Prefer lud16 (lightning address) over lud06 (bech32 LNURL). */
export function getRecipientLnurl(
  profile: LightningProfile | null | undefined,
): string | null {
  if (!profile) return null;
  const addr = profile.lud16?.trim() || profile.lud06?.trim();
  return addr || null;
}

export async function fetchLNURLPayEndpoint(
  addressOrLnurl: string,
): Promise<LNURLPayEndpoint> {
  const url = parseLNURLOrAddress(addressOrLnurl);
  if (!url) throw new Error("Invalid lightning address or LNURL");

  const res = await fetch(url.toString());
  if (!res.ok)
    throw new Error(`Failed to fetch LNURL pay endpoint: ${res.statusText}`);

  const data = await res.json();
  if (!data.callback) throw new Error("Invalid LNURL pay endpoint");

  return {
    callback: data.callback,
    minSendable: data.minSendable ?? 1000,
    maxSendable: data.maxSendable ?? 100_000_000_000,
    allowsNostr: !!data.allowsNostr,
    nostrPubkey: data.nostrPubkey,
  };
}

/**
 * Fetch a bolt11 invoice from the LNURL callback, passing the signed zap
 * request as the `nostr` query param so the provider will publish a kind:9735
 * receipt after payment.
 */
export async function fetchZapInvoice(
  callback: string,
  zapRequest: NostrEvent,
  amountMsats: number,
): Promise<string> {
  const url = new URL(callback);
  url.searchParams.set("amount", amountMsats.toString());
  url.searchParams.set("nostr", JSON.stringify(zapRequest));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to fetch invoice: ${res.statusText}`);

  const data = await res.json();
  if (data.status === "ERROR")
    throw new Error(data.reason || "LNURL server returned an error");
  if (!data.pr) throw new Error("No invoice returned from LNURL server");
  return data.pr as string;
}

/** Build, sign, and return a kind:9734 zap request event for the target. */
export async function signZapRequest(
  signer: ISigner,
  targetEvent: NostrEvent,
  amountMsats: number,
  zapRelays: string[],
  message?: string,
): Promise<NostrEvent> {
  let factory = ZapRequestFactory.event(targetEvent, amountMsats, zapRelays);
  if (message && message.trim()) factory = factory.message(message.trim());
  return factory.sign(signer);
}

/**
 * Pick which relays go into the zap request's `relays` tag. The LNURL provider
 * publishes the receipt to these.
 *
 * Priority: repo relays fill most slots, but we always guarantee:
 *   - at least 1 recipient inbox (so the recipient sees the zap)
 *   - at least 1 sender outbox (so the sender sees their own receipt)
 *   - if neither inbox nor outbox is available, at least 1 fallback
 *
 * After reserving those guaranteed slots, remaining slots are filled with repo
 * relays first, then leftover inboxes/outboxes/fallback. Deduplicates and caps
 * at `max` (default 8).
 */
export function pickZapRelays(
  recipientInboxes: string[] | undefined,
  fallback: string[],
  max = 8,
  repoRelays: string[] = [],
  senderOutboxes: string[] = [],
): string[] {
  const inboxes = recipientInboxes ?? [];

  // Reserve guaranteed slots so no single set can monopolise the list.
  const guaranteed = new Set<string>();
  if (inboxes[0]) guaranteed.add(inboxes[0]);
  if (senderOutboxes[0]) guaranteed.add(senderOutboxes[0]);
  if (guaranteed.size === 0 && fallback[0]) guaranteed.add(fallback[0]);

  // Fill remaining slots: repo relays first, then leftover inboxes/outboxes/fallback.
  const result = new Set<string>(guaranteed);
  for (const relay of [
    ...repoRelays,
    ...inboxes,
    ...senderOutboxes,
    ...fallback,
  ]) {
    if (result.size >= max) break;
    result.add(relay);
  }

  return [...result];
}
