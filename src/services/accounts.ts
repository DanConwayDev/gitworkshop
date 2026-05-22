import { AccountManager } from "applesauce-accounts";
import {
  NostrConnectAccount,
  registerCommonAccountTypes,
} from "applesauce-accounts/accounts";
import { applySignerNudge } from "@/hooks/useLoginActions";
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

// Suppresses local localStorage writes during a cross-tab sync so the
// persistence subscriptions below do not echo the incoming state back to
// storage, which would overwrite the other tab's authoritative values and
// trigger spurious storage events in all other open tabs.
let isApplyingCrossTabSync = false;

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
        // Apply nudge wrapper to all restored accounts that benefit from it.
        applySignerNudge(account);
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
    if (isApplyingCrossTabSync) return;
    try {
      localStorage.setItem("accounts", JSON.stringify(accounts.toJSON(true)));
    } catch (error) {
      console.error("Failed to persist accounts:", error);
    }
  });

  // Persist active account id whenever it changes
  accounts.active$.subscribe((account) => {
    if (isApplyingCrossTabSync) return;
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

  // Keep a persistent subscription open for the active user's replaceable
  // events (kinds 0, 3, 10002, 10017, 10018, 10317) on the union of their
  // outbox relays and lookup/index relays.
  //
  // Strategy: whenever the active account changes OR their NIP-65 outbox relay
  // list changes, tear down the previous subscription and start a fresh one on
  // the updated relay set. This ensures all user replaceable events are always
  // as fresh as possible — the prerequisite for safe replaceable event edits.
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

  // Cross-tab sync: propagate account state changes made in other browser tabs.
  // The `storage` event only fires in tabs that did NOT write the key, so no
  // debounce or self-suppression is needed.
  window.addEventListener("storage", async (event: StorageEvent) => {
    if (event.key === "accounts") {
      // Snapshot existing NostrConnect signers by account id so we can reuse
      // already-open in-memory signers after fromJSON rebuilds the list.
      // The signer may already be Proxy-wrapped by applySignerNudge — preserve it as-is
      // so the NIP-46 relay subscription is not torn down and re-opened.
      const preservedSigners = new Map<string, NostrConnectAccount["signer"]>();
      const existingIds = new Set<string>();
      for (const account of accounts.accounts$.getValue()) {
        existingIds.add(account.id);
        if (account instanceof NostrConnectAccount) {
          preservedSigners.set(account.id, account.signer);
        }
      }

      // Remember which account was active in this tab before fromJSON clears state.
      const preservedActiveId = accounts.getActive()?.id;

      // Guard the persistence subscriptions so they do not echo the incoming
      // state back to localStorage while we apply the cross-tab update.
      isApplyingCrossTabSync = true;
      try {
        // fromJSON clears all existing accounts and reconstructs from the list.
        // JSON.parse returns `any`, which satisfies SerializedAccount[].
        await accounts.fromJSON(
          event.newValue ? JSON.parse(event.newValue) : [],
          true,
        );

        // Re-wire each account after reconstruction.
        for (const account of accounts.accounts$.getValue()) {
          if (account instanceof NostrConnectAccount) {
            const preserved = preservedSigners.get(account.id);
            if (preserved) {
              // Already open in this tab — reuse the in-memory signer so the
              // live relay subscription is not torn down unnecessarily.
              account.signer = preserved;
            } else {
              // Genuinely new account — open the relay connection and apply
              // the nudge wrapper, mirroring what the init path does.
              account.signer.open().catch((err: unknown) => {
                console.warn(
                  "Cross-tab sync: failed to open NostrConnect session:",
                  err,
                );
              });
              account.signer.isConnected = true;
              applySignerNudge(account);
            }
          } else if (!existingIds.has(account.id)) {
            // New non-NostrConnect account — apply nudge wrapper.
            applySignerNudge(account);
          }
        }

        // Re-apply the active account that was live in this tab before the
        // sync, provided it still exists in the updated list.  If the other
        // tab also changed its active account, the subsequent
        // "active-account" storage event will override this.
        if (preservedActiveId) {
          const stillExists = accounts.accounts$
            .getValue()
            .some((a) => a.id === preservedActiveId);
          if (stillExists) {
            accounts.setActive(preservedActiveId);
          }
          // If the account was removed (logout in the other tab), leave
          // active as null/undefined — fromJSON already cleared it.
        }
      } catch (err) {
        console.error("Cross-tab accounts sync failed:", err);
      } finally {
        isApplyingCrossTabSync = false;
      }
    } else if (event.key === "active-account") {
      // Another tab switched or cleared the active account — mirror it here.
      try {
        if (event.newValue) {
          accounts.setActive(event.newValue);
        } else {
          accounts.clearActive();
        }
      } catch {
        // The account may not yet exist in this tab (e.g., if the "accounts"
        // storage event arrives slightly after this one).  Ignore silently.
      }
    }
  });
})();
