import { nip19 } from "nostr-tools";

/**
 * Returns a short npub placeholder for a pubkey when no profile name is
 * available. Format: `npub1xxxx…` — just the first 4 unique chars after
 * "npub1" so it's easy to cross-reference on the current page without being
 * mistaken for a user-chosen name.
 */
export function genUserName(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 9)}…`; // "npub1" + 4 chars + ellipsis
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}
