import { useState, useEffect } from "react";
import { IdentityStatus } from "applesauce-loaders/helpers";
import type { Identity } from "applesauce-loaders/helpers";
import { dnsIdentityLoader, nip05WarmupReady } from "@/services/nostr";

const RESOLVE_TIMEOUT_MS = 5_000;

export type DnsIdentityState =
  | { status: "loading" }
  | { status: "found"; pubkey: string; relays: string[] }
  | { status: "not-found" }
  | {
      status: "error";
      reason: "timeout" | "network" | "unknown";
      message: string;
    };

/** Convert a cached Identity to a DnsIdentityState. */
function cachedIdentityToState(cached: Identity): DnsIdentityState {
  if (cached.status === IdentityStatus.Found) {
    return {
      status: "found",
      pubkey: cached.pubkey,
      relays: cached.relays ?? [],
    };
  } else if (cached.status === IdentityStatus.Missing) {
    return { status: "not-found" };
  } else {
    return { status: "error", reason: "unknown", message: cached.error };
  }
}

/**
 * Parse a standardised NIP-05 address into (name, domain). Returns null for
 * invalid input.
 */
function parseNip05(nip05: string): { name: string; domain: string } | null {
  const atIdx = nip05.indexOf("@");
  if (atIdx === -1) return null;
  return { name: nip05.slice(0, atIdx), domain: nip05.slice(atIdx + 1) };
}

/**
 * Resolves a NIP-05 address (user@domain.com or _@domain.com) to a pubkey.
 * Uses the global DnsIdentityLoader which caches results for the session.
 * Fails with a "timeout" reason if the lookup takes longer than RESOLVE_TIMEOUT_MS.
 *
 * The in-memory cache is checked synchronously during initialisation so that
 * identities already resolved this session (e.g. via usePrefetchNip05) are
 * available on the very first render — no loading flash.
 */
export function useDnsIdentity(nip05: string | undefined): DnsIdentityState {
  const [state, setState] = useState<DnsIdentityState>(() => {
    // Check the in-memory cache synchronously so components that arrive from
    // the repositories list (where usePrefetchNip05 has already run) render
    // the resolved state immediately without a loading flash.
    if (!nip05) return { status: "loading" };
    const parsed = parseNip05(nip05);
    if (!parsed) return { status: "loading" };
    const cached = dnsIdentityLoader.getIdentity(parsed.name, parsed.domain);
    return cached ? cachedIdentityToState(cached) : { status: "loading" };
  });

  useEffect(() => {
    if (!nip05) return;

    const parsed = parseNip05(nip05);
    if (!parsed) {
      setState({
        status: "error",
        reason: "unknown",
        message: `Invalid NIP-05 address: ${nip05}`,
      });
      return;
    }
    const { name, domain } = parsed;

    let cancelled = false;

    // Await the IDB warmup before checking the in-memory cache. On a fresh
    // page load the warmup is async; if the user navigates to a NIP-05 repo
    // URL before it completes, getIdentity() would return undefined even
    // though IDB has the entry. Awaiting the warmup first ensures the
    // synchronous cache check always reflects the persisted state.
    nip05WarmupReady.then(() => {
      if (cancelled) return;

      // Check in-memory cache — avoids a loading flash when the identity is
      // already resolved (e.g. back-navigation or warm IDB).
      const cached = dnsIdentityLoader.getIdentity(name, domain);
      if (cached) {
        setState(cachedIdentityToState(cached));
        return;
      }

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("__timeout__")), RESOLVE_TIMEOUT_MS),
      );

      Promise.race([
        dnsIdentityLoader.loadIdentity(name, domain),
        timeoutPromise,
      ])
        .then((identity) => {
          if (cancelled) return;
          // Populate the in-memory map so subsequent getIdentity() calls hit.
          dnsIdentityLoader.identities.set(`${name}@${domain}`, identity);
          setState(cachedIdentityToState(identity));
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof Error && err.message === "__timeout__") {
            setState({
              status: "error",
              reason: "timeout",
              message: `Lookup timed out after ${RESOLVE_TIMEOUT_MS / 1000} seconds`,
            });
          } else {
            const msg =
              err instanceof Error
                ? err.message
                : "Failed to resolve NIP-05 identity";
            // "Failed to fetch" is the browser's generic network error
            const isNetwork =
              err instanceof TypeError ||
              (err instanceof Error &&
                err.message.toLowerCase().includes("fetch"));
            setState({
              status: "error",
              reason: isNetwork ? "network" : "unknown",
              message: msg,
            });
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [nip05]);

  return state;
}
