/**
 * nostrContentTags — extract NIP-19 references from composer content and
 * produce the appropriate Nostr tags to attach to the published event.
 *
 * Rules (per NIP-27 / NIP-18):
 *   nostr:npub1…  / nostr:nprofile1… → ["p", "<pubkey>"]
 *   nostr:note1…  / nostr:nevent1…   → ["q", "<event-id>", "<relay-hint>", "<author-pubkey>"]
 *   nostr:naddr1…                    → ["q", "<kind>:<pubkey>:<d-tag>", "<relay-hint>"]
 *
 * Duplicate references are deduplicated: one tag per unique pubkey / event-id /
 * address coordinate.
 */

import { nip19 } from "nostr-tools";

// Matches all nostr: prefixed NIP-19 identifiers in content
const NOSTR_EMBED_RE =
  /nostr:(npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/g;

export type NostrTag = string[];

/**
 * Parse all `nostr:…` references in `content` and return the corresponding
 * Nostr tags that should be included on the published event.
 *
 * Returns an empty array when no recognisable references are found.
 */
export function extractContentTags(content: string): NostrTag[] {
  const pTags = new Map<string, NostrTag>(); // keyed by pubkey hex
  const qTags = new Map<string, NostrTag>(); // keyed by event-id hex or naddr coordinate

  NOSTR_EMBED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = NOSTR_EMBED_RE.exec(content)) !== null) {
    const identifier = match[0].slice(6); // strip "nostr:"

    try {
      const decoded = nip19.decode(identifier);

      switch (decoded.type) {
        case "npub": {
          const pubkey = decoded.data;
          if (!pTags.has(pubkey)) {
            pTags.set(pubkey, ["p", pubkey]);
          }
          break;
        }

        case "nprofile": {
          const { pubkey, relays } = decoded.data;
          if (!pTags.has(pubkey)) {
            const relay = relays?.[0] ?? "";
            pTags.set(pubkey, relay ? ["p", pubkey, relay] : ["p", pubkey]);
          }
          break;
        }

        case "note": {
          const id = decoded.data;
          if (!qTags.has(id)) {
            qTags.set(id, ["q", id, ""]);
          }
          break;
        }

        case "nevent": {
          const { id, relays, author } = decoded.data;
          if (!qTags.has(id)) {
            const relay = relays?.[0] ?? "";
            const tag: NostrTag = ["q", id, relay];
            if (author) tag.push(author);
            qTags.set(id, tag);
          }
          break;
        }

        case "naddr": {
          const { kind, pubkey, identifier: dTag, relays } = decoded.data;
          const coord = `${kind}:${pubkey}:${dTag}`;
          if (!qTags.has(coord)) {
            const relay = relays?.[0] ?? "";
            qTags.set(coord, ["q", coord, relay]);
          }
          break;
        }

        default:
          break;
      }
    } catch {
      // Invalid / unrecognised identifier — skip silently
    }
  }

  return [...pTags.values(), ...qTags.values()];
}
