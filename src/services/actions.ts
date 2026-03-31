import { ActionRunner, Actions } from "applesauce-actions";
import { EventFactory } from "applesauce-core";
import type { NostrEvent } from "nostr-tools";
import { eventStore, publish } from "./nostr";
import { lookupRelays } from "./settings";
import { accounts } from "./accounts";
import { USER_REPLACEABLE_KINDS } from "./userIdentitySubscription";

/** Set of user replaceable kinds for fast lookup in runnerPublish. */
const USER_REPLACEABLE_SET = new Set<number>(USER_REPLACEABLE_KINDS);

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
 * For any user replaceable event kind (contacts, relay list, grasp list,
 * git authors, git repositories, etc.), lookup/index relays are added as a
 * separate "User Index Relays" group so that the updated event reaches
 * well-connected index relays in addition to the user's own outbox relays.
 * This improves the chance that other clients can discover the latest event
 * even if they don't know all of the user's outbox relays.
 *
 * For all other events the call is forwarded to publish() unchanged.
 */
function runnerPublish(event: NostrEvent, relays?: string[]): Promise<void> {
  if (USER_REPLACEABLE_SET.has(event.kind)) {
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
