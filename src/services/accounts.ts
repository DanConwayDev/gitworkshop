import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";

/**
 * Global AccountManager instance for multi-account support.
 * Handles adding, removing, and switching between Nostr accounts.
 */
export const accounts = new AccountManager();

// Register common account types (Extension, PrivateKey, NostrConnect, etc.)
registerCommonAccountTypes(accounts);

// Restore persisted accounts and active account from localStorage
(async () => {
  try {
    const savedAccounts = localStorage.getItem("accounts");
    if (savedAccounts) {
      const json = JSON.parse(savedAccounts);
      await accounts.fromJSON(json);
    }
  } catch (error) {
    console.error("Failed to restore accounts from localStorage:", error);
  }

  try {
    const lastActive = localStorage.getItem("active-account");
    if (lastActive) {
      accounts.setActive(lastActive);
    }
  } catch (error) {
    console.error("Failed to restore last active account:", error);
  }
})();

// Persist accounts to localStorage whenever they change
accounts.accounts$.subscribe(() => {
  localStorage.setItem("accounts", JSON.stringify(accounts.toJSON()));
});

// Persist active account id to localStorage
accounts.active$.subscribe((account) => {
  localStorage.setItem("active-account", account?.id ?? "");
});
