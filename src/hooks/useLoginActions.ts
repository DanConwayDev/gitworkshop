import { APP_NAME } from "@/lib/constants";
import { accounts } from "@/services/accounts";
import { pool } from "@/services/nostr";
import { extraRelays } from "@/services/settings";
import { Accounts } from "applesauce-accounts";
import {
  ExtensionSigner,
  NostrConnectSigner,
  PrivateKeySigner,
} from "applesauce-signers";
import { nip19 } from "nostr-tools";

// NOTE: This file should not be edited except for adding new login methods.

/** Check if running on an actual mobile device (not just a small screen) */
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Parameters for a pending nostrconnect:// session */
export interface NostrConnectSession {
  /** The ephemeral signer created for this session */
  signer: NostrConnectSigner;
  /** The nostrconnect:// URI to display as a QR code / deep link */
  uri: string;
}

/**
 * Creates a new nostrconnect:// session.
 * Generates an ephemeral signer, builds the URI, and returns both so the
 * caller can display the QR code while separately awaiting the connection.
 */
export function createNostrConnectSession(
  appName?: string,
): NostrConnectSession {
  const relays = extraRelays.getValue();
  const fallback = ["wss://relay.damus.io", "wss://relay.primal.net"];
  const sessionRelays = relays.length > 0 ? relays : fallback;

  const signer = new NostrConnectSigner({ relays: sessionRelays, pool });

  const metadata: Parameters<NostrConnectSigner["getNostrConnectURI"]>[0] = {
    name: appName ?? APP_NAME,
    url: typeof window !== "undefined" ? window.location.origin : undefined,
    permissions: NostrConnectSigner.buildSigningPermissions([0, 1, 3, 10002]),
  };

  // On mobile, the signer app is on the same device — no QR needed, just a
  // deep link. On desktop the user scans the QR with their phone.
  if (typeof window !== "undefined" && isMobileDevice()) {
    // nostrconnect:// URIs are handled by signer apps (e.g. Amber on Android)
    // No callback needed — we poll via waitForSigner.
  }

  const uri = signer.getNostrConnectURI(metadata);

  return { signer, uri };
}

/**
 * Provides actions for logging in with various Nostr signers.
 * Uses applesauce-accounts for multi-account management.
 */
export function useLoginActions() {
  return {
    /**
     * Login with a Nostr secret key (nsec).
     * Creates a PrivateKeyAccount and adds it to the account manager.
     */
    async nsec(nsec: string): Promise<void> {
      try {
        const decoded = nip19.decode(nsec);
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec format");
        }

        const secretKey = decoded.data; // Uint8Array
        const signer = new PrivateKeySigner(secretKey);
        const pubkey = await signer.getPublicKey();
        const account = new Accounts.PrivateKeyAccount(pubkey, signer);

        accounts.addAccount(account);
        accounts.setActive(account);
      } catch (error) {
        console.error("Failed to login with nsec:", error);
        throw new Error("Invalid secret key");
      }
    },

    /**
     * Login with a NIP-46 "bunker://" URI (Nostr Connect).
     * Creates a NostrConnectAccount and adds it to the account manager.
     */
    async bunker(uri: string): Promise<void> {
      try {
        const signer = await NostrConnectSigner.fromBunkerURI(uri);
        const pubkey = await signer.getPublicKey();

        const existing = accounts.getAccountForPubkey(pubkey);
        if (existing) {
          accounts.setActive(existing);
          return;
        }

        const account = new Accounts.NostrConnectAccount(pubkey, signer);
        accounts.addAccount(account);
        accounts.setActive(account);
      } catch (error) {
        console.error("Failed to login with bunker:", error);
        throw new Error("Failed to connect to remote signer");
      }
    },

    /**
     * Login via nostrconnect:// (client-initiated NIP-46).
     * The caller must first call createNostrConnectSession() to get the URI
     * for display, then pass the session here to await the connection.
     */
    async nostrconnect(
      session: NostrConnectSession,
      abortSignal?: AbortSignal,
    ): Promise<void> {
      try {
        await session.signer.waitForSigner(abortSignal);

        const pubkey = await session.signer.getPublicKey();

        const existing = accounts.getAccountForPubkey(pubkey);
        if (existing) {
          accounts.setActive(existing);
          return;
        }

        const account = new Accounts.NostrConnectAccount(
          pubkey,
          session.signer,
        );
        accounts.addAccount(account);
        accounts.setActive(account);
      } catch (error) {
        console.error("Failed to login with nostrconnect:", error);
        throw error;
      }
    },

    /**
     * Login with a NIP-07 browser extension.
     * Creates an ExtensionAccount and adds it to the account manager.
     */
    async extension(): Promise<void> {
      try {
        if (!("nostr" in window)) {
          throw new Error(
            "Nostr extension not found. Please install a NIP-07 extension.",
          );
        }

        const pubkey = await window.nostr!.getPublicKey();

        const existing = accounts.getAccountForPubkey(pubkey);
        if (existing) {
          accounts.setActive(existing);
          return;
        }

        const signer = new ExtensionSigner();
        const account = new Accounts.ExtensionAccount(pubkey, signer);

        accounts.addAccount(account);
        accounts.setActive(account);
      } catch (error) {
        console.error("Failed to login with extension:", error);
        throw error;
      }
    },

    /**
     * Log out the current user.
     * Removes the active account from the account manager.
     */
    logout(): void {
      const activeAccount = accounts.getActive();
      if (activeAccount) {
        accounts.removeAccount(activeAccount.id);
      }
    },
  };
}
