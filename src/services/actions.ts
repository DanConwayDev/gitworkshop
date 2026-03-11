import { ActionRunner, Actions } from "applesauce-actions";
import { EventFactory } from "applesauce-core";
import { eventStore, publish } from "./nostr";
import { accounts } from "./accounts";

/**
 * Get the current active account's signer.
 * Throws if no account is logged in.
 */
function getActiveSigner() {
  const account = accounts.getActive();
  if (!account) {
    throw new Error("No account is currently logged in");
  }
  return account.signer;
}

/**
 * Global EventFactory instance for creating signed events.
 * Uses the active account's signer.
 */
export const factory = new EventFactory({
  // @ts-expect-error - Signer type compatibility
  signer: getActiveSigner,
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
