import { toast } from "@/hooks/useToast";
import { accounts } from "@/services/accounts";
import { Accounts } from "applesauce-accounts";
import {
  ExtensionSigner,
  NostrConnectSigner,
  PrivateKeySigner,
} from "applesauce-signers";
import { nip19 } from "nostr-tools";

// NOTE: This file should not be edited except for adding new login methods.

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
        // Decode nsec to get secret key
        const decoded = nip19.decode(nsec);
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec format");
        }

        // Create private key signer and account
        const secretKey = decoded.data; // Uint8Array
        const signer = new PrivateKeySigner(secretKey);
        const pubkey = await signer.getPublicKey();
        const account = new Accounts.PrivateKeyAccount(pubkey, signer);

        // Add to account manager
        accounts.addAccount(account);

        accounts.setActive(account.pubkey);
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
        // Use fromBunkerURI to create and connect the signer
        // This handles parsing the URI and connecting to the remote signer
        const signer = await NostrConnectSigner.fromBunkerURI(uri);

        // Get the user's pubkey from the connected signer
        const pubkey = await signer.getPublicKey();

        // Check if this account is already logged in
        const existing = accounts.getAccountForPubkey(pubkey);

        if (existing) {
          // Just switch to the existing account
          accounts.setActive(existing.pubkey);
          toast({
            title: "Already logged in",
            description: "Switched to existing account",
          });
          return;
        }

        // Create NostrConnectAccount with the pubkey and signer
        const account = new Accounts.NostrConnectAccount(pubkey, signer);

        // Add to account manager
        accounts.addAccount(account);

        accounts.setActive(account.pubkey);
      } catch (error) {
        console.error("Failed to login with bunker:", error);
        throw new Error("Failed to connect to remote signer");
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

        // Get pubkey from extension first
        const pubkey = await window.nostr!.getPublicKey();

        // Check if this account is already logged in
        const existing = accounts.getAccountForPubkey(pubkey);

        if (existing) {
          // Just switch to the existing account
          accounts.setActive(existing.pubkey);
          toast({
            title: "Already logged in",
            description: "Switched to existing account",
          });
          return;
        }

        // Create extension account
        const signer = new ExtensionSigner();
        const account = new Accounts.ExtensionAccount(pubkey, signer);

        // Add to account manager
        accounts.addAccount(account);

        accounts.setActive(account.pubkey);
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
        accounts.removeAccount(activeAccount.pubkey);
      }
    },
  };
}
