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
 * publishes the receipt to these, so they should be relays the user and the
 * public can read. Keep the list small — most providers cap at 4–5.
 */
export function pickZapRelays(
  recipientInboxes: string[] | undefined,
  fallback: string[],
  max = 5,
): string[] {
  const merged = [...(recipientInboxes ?? []), ...fallback];
  return [...new Set(merged)].slice(0, max);
}
