/**
 * TestSigner — an in-memory NIP-07-style signer backed by a generated secret
 * key, for use in e2e tests.
 *
 * Implements the `EventSigner` interface that applesauce's `EventFactory`
 * expects (`getPublicKey` + `signEvent`), plus exposes the raw secret key for
 * tests that need to sign events directly with nostr-tools.
 */

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type EventTemplate,
  type NostrEvent,
} from "nostr-tools";

export class TestSigner {
  /** 32-byte secret key. */
  readonly secretKey: Uint8Array;
  /** 64-char hex public key. */
  readonly pubkey: string;

  constructor(secretKey?: Uint8Array) {
    this.secretKey = secretKey ?? generateSecretKey();
    this.pubkey = getPublicKey(this.secretKey);
  }

  /** npub-encoded public key. */
  get npub(): string {
    return nip19.npubEncode(this.pubkey);
  }

  /** nsec-encoded secret key. */
  get nsec(): string {
    return nip19.nsecEncode(this.secretKey);
  }

  // --- EventSigner interface (applesauce) ---

  getPublicKey(): string {
    return this.pubkey;
  }

  signEvent(draft: EventTemplate): NostrEvent {
    return finalizeEvent(draft, this.secretKey);
  }
}
