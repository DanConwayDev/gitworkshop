/**
 * NIP-07 window.nostr interface
 */
import type { EventTemplate, NostrEvent } from "nostr-tools";

interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<NostrEvent>;
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

export {};
