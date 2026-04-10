import { APP_NAME } from "@/lib/constants";
import { accounts } from "@/services/accounts";
import { pool } from "@/services/nostr";
import { defaultNostrConnectRelays } from "@/services/settings";
import { signerWithNudge } from "@/lib/signerWithNudge";
import { Accounts } from "applesauce-accounts";
import { NostrConnectAccount } from "applesauce-accounts/accounts";
import type { IAccount } from "applesauce-accounts";
import {
  ExtensionSigner,
  NostrConnectSigner,
  PrivateKeySigner,
} from "applesauce-signers";
import { nip19 } from "nostr-tools";

// NOTE: This file should not be edited except for adding new login methods.

/**
 * Wraps the signer on an account with {@link signerWithNudge} so that slow or
 * pending remote-signer operations surface a toast nudge to the user.
 *
 * - NostrConnect accounts: also wires up a relay-connectivity check so the
 *   toast can warn when the bunker relay WebSocket is not open.
 * - Extension accounts: wrapped without a connectivity check (nudge still
 *   helps when the user dismisses or ignores the extension popup).
 * - PrivateKey accounts: not wrapped — local signing is instant.
 *
 * Mutates `account.signer` in place and returns the account for chaining.
 */
export function applySignerNudge<T extends IAccount>(account: T): T {
  if (account instanceof NostrConnectAccount) {
    const nostrConnectSigner = account.signer as NostrConnectSigner;
    // Connectivity check: the signer is considered reachable when it is
    // actively listening on its relay subscription AND the session is marked
    // connected. This is the best available proxy without reaching into pool
    // WebSocket internals — if either flag is false the relay is effectively
    // unreachable for NIP-46 purposes.
    const isBunkerConnected = () =>
      nostrConnectSigner.listening && nostrConnectSigner.isConnected;
    account.signer = signerWithNudge(
      nostrConnectSigner,
      isBunkerConnected,
    ) as typeof account.signer;
  } else if (account instanceof Accounts.ExtensionAccount) {
    // Extension signers benefit from the nudge (user may dismiss or ignore the
    // browser popup) but have no relay connectivity to check.
    account.signer = signerWithNudge(account.signer) as typeof account.signer;
  }
  // PrivateKeyAccount: local signing is synchronous — no nudge needed.
  return account;
}

/** Check if running on an actual mobile device (not just a small screen) */
export function isMobileDevice(): boolean {
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
 *
 * @param appName - Optional app name to embed in the URI metadata
 * @param relays  - Optional relay override; falls back to {@link defaultNostrConnectRelays}
 */
export function createNostrConnectSession(
  appName?: string,
  relays?: string[],
): NostrConnectSession {
  const sessionRelays = relays ?? defaultNostrConnectRelays.getValue();

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

        // Only skip adding if a NostrConnect account for this pubkey already
        // exists — a different signer type (e.g. extension) for the same pubkey
        // is a distinct account and should be added separately.
        const existing = accounts
          .getAccountsForPubkey(pubkey)
          .find((a) => a instanceof Accounts.NostrConnectAccount);
        if (existing) {
          accounts.setActive(existing);
          return;
        }

        const account = applySignerNudge(
          new Accounts.NostrConnectAccount(pubkey, signer),
        );
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

        // Only skip adding if a NostrConnect account for this pubkey already
        // exists — a different signer type (e.g. extension) for the same pubkey
        // is a distinct account and should be added separately.
        const existing = accounts
          .getAccountsForPubkey(pubkey)
          .find((a) => a instanceof Accounts.NostrConnectAccount);
        if (existing) {
          accounts.setActive(existing);
          return;
        }

        const account = applySignerNudge(
          new Accounts.NostrConnectAccount(pubkey, session.signer),
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
        const account = applySignerNudge(
          new Accounts.ExtensionAccount(pubkey, signer),
        );

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
