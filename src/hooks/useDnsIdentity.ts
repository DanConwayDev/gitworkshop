import { useState, useEffect } from "react";
import { IdentityStatus } from "applesauce-loaders/helpers";
import { dnsIdentityLoader } from "@/services/nostr";

export type DnsIdentityState =
  | { status: "loading" }
  | { status: "found"; pubkey: string; relays: string[] }
  | { status: "not-found" }
  | { status: "error"; message: string };

/**
 * Resolves a NIP-05 address (user@domain.com or _@domain.com) to a pubkey.
 * Uses the global DnsIdentityLoader which caches results for the session.
 */
export function useDnsIdentity(nip05: string | undefined): DnsIdentityState {
  const [state, setState] = useState<DnsIdentityState>({ status: "loading" });

  useEffect(() => {
    if (!nip05) return;

    setState({ status: "loading" });

    // Split standardised "user@domain.com" into name + domain
    const atIdx = nip05.indexOf("@");
    if (atIdx === -1) {
      setState({
        status: "error",
        message: `Invalid NIP-05 address: ${nip05}`,
      });
      return;
    }
    const name = nip05.slice(0, atIdx);
    const domain = nip05.slice(atIdx + 1);

    // Check if already cached synchronously
    const cached = dnsIdentityLoader.getIdentity(name, domain);
    if (cached) {
      if (cached.status === IdentityStatus.Found) {
        setState({
          status: "found",
          pubkey: cached.pubkey,
          relays: cached.relays ?? [],
        });
      } else if (cached.status === IdentityStatus.Missing) {
        setState({ status: "not-found" });
      } else {
        setState({ status: "error", message: cached.error });
      }
      return;
    }

    let cancelled = false;
    dnsIdentityLoader
      .loadIdentity(name, domain)
      .then((identity) => {
        if (cancelled) return;
        if (identity.status === IdentityStatus.Found) {
          setState({
            status: "found",
            pubkey: identity.pubkey,
            relays: identity.relays ?? [],
          });
        } else if (identity.status === IdentityStatus.Missing) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: identity.error });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Failed to resolve NIP-05 identity",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [nip05]);

  return state;
}
