/**
 * Account bootstrap actions — CreateAccount.
 *
 * Used during the signup flow to publish the initial kind:0 profile and
 * kind:10002 relay list for a brand-new Nostr identity.
 *
 * Relay strategy:
 *   - Bootstrap relays (hardcoded): relay.ditto.pub, relay.damus.io, nos.lol
 *     These are large, well-connected relays that give the new account
 *     immediate visibility on the network.
 *   - Lookup / user-index relays (from settings): purplepag.es,
 *     index.hzrd149.com, indexer.coracle.social
 *     Publishing here ensures relay-indexers pick up the new account's
 *     kind:10002 immediately, so other clients can discover the user's
 *     outbox relays via the outbox model.
 *
 * Both events are published through outboxStore so retry logic and the
 * outbox panel apply. We bypass the generic nostr.ts publish() and call
 * outboxStore.publish() directly (same pattern as nip34.ts) so we can
 * supply precise relay groups rather than the user's fallbackRelays.
 */

import type { Action } from "applesauce-actions";
import { ProfileFactory } from "applesauce-core/factories";
import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import type { ProfileContent } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import { outboxStore } from "@/services/outbox";
import { eventStore } from "@/services/nostr";

/** Relays every new account is bootstrapped onto (inbox + outbox). */
export const ACCOUNT_BOOTSTRAP_RELAYS = [
  "wss://relay.ditto.pub",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

/**
 * Group IDs used for publishing bootstrap events.
 *   "bootstrap-relays" → the three hardcoded bootstrap relays (resolved by nostr.ts)
 *   "index-relays"     → the current lookup/user-index relays (resolved by nostr.ts)
 */
const BOOTSTRAP_GROUP_IDS = ["bootstrap-relays", "index-relays"];

/**
 * Publish the initial kind:0 profile and kind:10002 relay list for a new
 * Nostr account.
 *
 * @param displayName - The user's chosen display name
 *
 * The kind:10002 relay list sets all three bootstrap relays as both read
 * and write relays (plain "r" tag = read + write per NIP-65) so the account
 * is immediately reachable and discoverable.
 * Both events are also sent to the lookup/index relays so relay-indexers
 * (purplepag.es etc.) pick up the new account straight away.
 */
export function CreateAccount(displayName: string): Action {
  return async ({ signer }) => {
    // --- kind:0 profile ---
    const profileContent: ProfileContent = { name: displayName };
    const profileSigned = await ProfileFactory.create()
      .override(profileContent)
      .sign(signer);
    eventStore.add(profileSigned);
    await outboxStore.publish(profileSigned, BOOTSTRAP_GROUP_IDS);

    // --- kind:10002 relay list ---
    // Plain "r" tag (no read/write marker) = both read and write per NIP-65.
    const relayTags = ACCOUNT_BOOTSTRAP_RELAYS.map((url): [string, string] => [
      "r",
      url,
    ]);
    const mailboxesSigned = await new EventFactory((resolve) =>
      resolve(blankEventTemplate(kinds.RelayList)),
    )
      .modifyPublicTags((tags) => [...tags, ...relayTags])
      .sign(signer);
    eventStore.add(mailboxesSigned);
    await outboxStore.publish(mailboxesSigned, BOOTSTRAP_GROUP_IDS);
  };
}
