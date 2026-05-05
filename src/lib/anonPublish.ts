/**
 * Anonymous publishing utilities.
 *
 * Creates a one-shot ActionRunner backed by an ephemeral PrivateKeySigner.
 * The generated key is random and discarded after use — the event is
 * permanently unlinked from any real identity.
 *
 * Usage:
 *   const anonRunner = createAnonRunner();
 *   await anonRunner.run(CreateIssue, ...args);
 */

import { ActionRunner } from "applesauce-actions";
import { PrivateKeySigner } from "applesauce-signers";
import { eventStore, publish } from "@/services/nostr";

/**
 * Create a one-shot ActionRunner with a fresh ephemeral key.
 *
 * Each call generates a new random private key so successive anonymous
 * posts are not linkable to each other.
 *
 * In Applesauce v6 the ActionRunner takes the signer directly — the old
 * `EventFactory` intermediary is gone.
 */
export function createAnonRunner(): ActionRunner {
  const signer = new PrivateKeySigner(); // no key arg → random key generated
  return new ActionRunner(eventStore, signer, publish);
}
