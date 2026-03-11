import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";

/**
 * Global AccountManager instance for multi-account support.
 * Handles adding, removing, and switching between Nostr accounts.
 */
export const accounts = new AccountManager();

// Register common account types (Extension, PrivateKey, NostrConnect, etc.)
registerCommonAccountTypes(accounts);

// Load accounts on initialization
try {
  const savedAccounts = localStorage.getItem("accounts");
  if (savedAccounts) {
    try {
      const accounts = JSON.parse(savedAccounts);
      // Accounts will be restored when user logs in
      console.log("Found saved account metadata:", accounts);
    } catch (error) {
      console.error("Failed to parse saved accounts", error);
    }
  }
} catch (error) {
  console.error("Failed to load accounts from localstorage");
  console.error(error);
}

try {
  const lastActive = localStorage.getItem("active-account");
  if (lastActive) {
    const account = accounts.getAccount(lastActive);
    if (account) accounts.setActive(account);
  }
} catch (error) {
  console.error("Failed to restore last active account");
  console.error(error);
}

// Persist accounts to localStorage
accounts.accounts$.subscribe(() => {
  localStorage.setItem("accounts", JSON.stringify(accounts.toJSON()));
});

// Persist active account to localStorage
accounts.active$.subscribe((account) => {
  localStorage.setItem("active-account", account?.id || "");
});
