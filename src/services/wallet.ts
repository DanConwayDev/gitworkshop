/**
 * Lightning wallet integration for zaps.
 *
 * Two transports are supported:
 *   - WebLN (window.webln) — auto-detected at runtime, requires no setup.
 *   - Nostr Wallet Connect (NIP-47) via `applesauce-wallet-connect` — the user
 *     pastes a nostr+walletconnect URI in Settings; the URI is persisted, and
 *     a WalletConnect instance is derived from it.
 *
 * The URI is the single persisted source of truth. `walletConnect$` is a
 * derived BehaviorSubject — when the URI changes, the previous instance is
 * dropped and a fresh one is constructed.
 */
import { BehaviorSubject } from "rxjs";
import { WalletConnect } from "applesauce-wallet-connect";
import { persist } from "@/services/settings";
import { pool } from "@/services/nostr";

/** Persisted NWC connection URI (nostr+walletconnect://...). */
export const walletConnectUri$ = new BehaviorSubject<string | null>(null);

persist(walletConnectUri$, "nwcConnection", {
  serialize: (v) => v ?? "",
  deserialize: (v) => (v ? v : null),
  defaultValue: null,
});

function buildWalletConnect(uri: string | null): WalletConnect | null {
  if (!uri) return null;
  try {
    return WalletConnect.fromConnectURI(uri, { pool });
  } catch (err) {
    console.warn("Failed to construct WalletConnect from URI:", err);
    return null;
  }
}

/**
 * Derived from `walletConnectUri$`. WalletConnect has no explicit dispose API
 * — its internal observables are lazy (only subscribe to relays when a method
 * is invoked), so dropping the reference is sufficient cleanup.
 */
export const walletConnect$ = new BehaviorSubject<WalletConnect | null>(
  buildWalletConnect(walletConnectUri$.getValue()),
);

walletConnectUri$.subscribe((uri) => {
  walletConnect$.next(buildWalletConnect(uri));
});

/** Disconnect the currently configured NWC wallet. */
export function disconnectWallet(): void {
  walletConnectUri$.next(null);
}

/** Update the persisted NWC URI. Validates by attempting to construct. */
export function setWalletConnectUri(uri: string): void {
  // Throws if invalid — caller catches and surfaces.
  WalletConnect.fromConnectURI(uri, { pool });
  walletConnectUri$.next(uri);
}

/** True when a WebLN provider is injected by the browser. */
export function hasWebLN(): boolean {
  return typeof window !== "undefined" && !!window.webln;
}

/** Prompt the user to grant the WebLN provider permission. */
export async function enableWebLN(): Promise<void> {
  if (!window.webln) throw new Error("No WebLN provider available");
  await window.webln.enable();
}
