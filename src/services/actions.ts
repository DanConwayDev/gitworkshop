import { ActionRunner, Actions } from "applesauce-actions";
import { EventFactory } from "applesauce-core";
import type { NostrEvent } from "nostr-tools";
import { eventStore, publish } from "./nostr";
import { lookupRelays } from "./settings";
import { accounts } from "./accounts";

/**
 * Kinds that user index relays (purplepag.es, etc.) are known to accept.
 * These are profile, contact, relay, and list kinds. Kind 30078 (NIP-78 app
 * data) is intentionally excluded — index relays reject application data
 * events as they are not list information.
 */
const INDEX_RELAY_KINDS = new Set<number>([
  0, // profile metadata
  3, // contact / follow list
  10002, // NIP-65 relay list (mailboxes)
  10017, // NIP-51 Git authors follow list
  10018, // NIP-51 Git repositories follow list
  10317, // Grasp server list
]);

/**
 * Global EventFactory instance for creating signed events.
 * Uses accounts.signer — a ProxySigner that automatically tracks the active
 * account, so switching accounts is reflected immediately without recreating
 * the factory.
 */
export const factory = new EventFactory({
  signer: accounts.signer,
});

/**
 * Publish function passed to the ActionRunner.
 *
 * For profile, contact, relay, and list kinds, lookup/index relays are added
 * as a separate "User Index Relays" group so that the updated event reaches
 * well-connected index relays in addition to the user's own outbox relays.
 * This improves discoverability for other clients.
 *
 * Kind 30078 (NIP-78 app data) is intentionally excluded — index relays
 * reject application data events as they are not list information.
 *
 * For all other events the call is forwarded to publish() unchanged.
 */
function runnerPublish(event: NostrEvent, relays?: string[]): Promise<void> {
  if (INDEX_RELAY_KINDS.has(event.kind)) {
    return publish(event, relays, {
      "User Index Relays": lookupRelays.getValue(),
    });
  }
  return publish(event, relays);
}

/**
 * Global ActionRunner instance for executing pre-built Nostr actions.
 * Examples: UpdateProfile, CreateNote, etc.
 *
 * Usage:
 * ```ts
 * import { runner, Actions } from '@/services/actions';
 *
 * await runner.run(Actions.UpdateProfile, { name: 'Alice' });
 * ```
 */
export const runner = new ActionRunner(eventStore, factory, runnerPublish);

// Export Actions for convenience
export { Actions };
