import { AccountManager } from "applesauce-accounts";
import {
  NostrConnectAccount,
  registerCommonAccountTypes,
} from "applesauce-accounts/accounts";
import { switchMap, distinctUntilChanged, map } from "rxjs/operators";
import { of } from "rxjs";
// Import pool to ensure NostrConnectSigner.pool is set before fromJSON runs,
// so restored NostrConnectAccount signers can be constructed successfully.
import {
  watchUserMailboxesForOutboxReResolve,
  eventStore,
} from "@/services/nostr";
import { startUserIdentitySubscription } from "@/services/userIdentitySubscription";
import { MailboxesModel } from "applesauce-core/models";

/**
 * Global AccountManager instance for multi-account support.
 * Handles adding, removing, and switching between Nostr accounts.
 */
export const accounts = new AccountManager();

// Register common account types (Extension, PrivateKey, NostrConnect, etc.)
registerCommonAccountTypes(accounts);

// Restore persisted accounts then wire up persistence subscriptions.
// Subscriptions are set up AFTER restoration so the initial active$.emit
// of undefined does not overwrite the stored active account id.
(async () => {
  try {
    const savedAccounts = localStorage.getItem("accounts");
    if (savedAccounts) {
      await accounts.fromJSON(JSON.parse(savedAccounts), true);

      // Re-open relay subscriptions for any restored NostrConnect accounts.
      // fromJSON reconstructs the signer with all credentials but does not
      // re-establish the NIP-46 relay subscription or mark the session as
      // connected. We call open() + set isConnected so signing works
      // immediately after a page refresh without a new connect handshake.
      for (const account of accounts.accounts$.getValue()) {
        if (account instanceof NostrConnectAccount) {
          account.signer.open().catch((err) => {
            console.warn("Failed to re-open NostrConnect session:", err);
          });
          account.signer.isConnected = true;
        }
      }
    }
  } catch (error) {
    console.error("Failed to restore accounts from localStorage:", error);
  }

  try {
    const lastActive = localStorage.getItem("active-account");
    if (lastActive) accounts.setActive(lastActive);
  } catch (error) {
    console.error("Failed to restore last active account:", error);
  }

  // Persist accounts whenever they change
  accounts.accounts$.subscribe(() => {
    try {
      localStorage.setItem("accounts", JSON.stringify(accounts.toJSON(true)));
    } catch (error) {
      console.error("Failed to persist accounts:", error);
    }
  });

  // Persist active account id whenever it changes
  accounts.active$.subscribe((account) => {
    localStorage.setItem("active-account", account?.id ?? "");
  });

  // Watch the active account's NIP-65 relay list and re-resolve relay groups
  // for any pending outbox items when it changes. Tear down the previous
  // subscription when the account switches.
  let unwatchMailboxes: (() => void) | null = null;
  accounts.active$.subscribe((account) => {
    unwatchMailboxes?.();
    unwatchMailboxes = null;
    if (account?.pubkey) {
      unwatchMailboxes = watchUserMailboxesForOutboxReResolve(account.pubkey);
    }
  });

  // Keep a persistent subscription open for the active user's identity events
  // (kind 0, 3, 10002, 10317) on their outbox relays.
  //
  // Strategy: whenever the active account changes OR their NIP-65 outbox relay
  // list changes, tear down the previous subscription and start a fresh one on
  // the updated relay set. This ensures kind:3 is always as fresh as possible
  // from ALL of the user's outbox relays — the prerequisite for safe follow
  // list edits.
  let stopIdentitySub: (() => void) | null = null;

  accounts.active$
    .pipe(
      switchMap((account) => {
        if (!account?.pubkey) return of(null);
        const pubkey = account.pubkey;
        return eventStore.model(MailboxesModel, pubkey).pipe(
          map((mailboxes) => ({ pubkey, outboxes: mailboxes?.outboxes ?? [] })),
          // Only restart when the serialised outbox list actually changes
          distinctUntilChanged(
            (a, b) =>
              a.pubkey === b.pubkey &&
              JSON.stringify([...a.outboxes].sort()) ===
                JSON.stringify([...b.outboxes].sort()),
          ),
        );
      }),
    )
    .subscribe((value) => {
      // Tear down the previous identity subscription before starting a new one
      stopIdentitySub?.();
      stopIdentitySub = null;
      if (value) {
        stopIdentitySub = startUserIdentitySubscription(
          value.pubkey,
          value.outboxes,
        );
      }
    });
})();
