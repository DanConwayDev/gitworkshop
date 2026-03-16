import { ActionRunner, Actions } from "applesauce-actions";
import { EventFactory } from "applesauce-core";
import { eventStore, publish } from "./nostr";
import { accounts } from "./accounts";

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
export const runner = new ActionRunner(eventStore, factory, publish);

// Export Actions for convenience
export { Actions };
