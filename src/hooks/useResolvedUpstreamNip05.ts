import { useEffect, useState } from "react";
import { IdentityStatus } from "applesauce-loaders/helpers";
import { repoCoordinate, type RepoUpstream } from "@/lib/nip34";
import type { PendingNip05Upstream } from "@/lib/repoUpstreamInput";
import { dnsIdentityLoader, nip05WarmupReady } from "@/services/nostr";

export type UpstreamNip05Status = "idle" | "loading" | "not-found" | "error";

export function useResolvedUpstreamNip05(
  pending: PendingNip05Upstream | undefined,
): {
  status: UpstreamNip05Status;
  resolvedUpstream: RepoUpstream | undefined;
} {
  const [status, setStatus] = useState<UpstreamNip05Status>("idle");
  const [resolvedUpstream, setResolvedUpstream] = useState<RepoUpstream>();

  useEffect(() => {
    setResolvedUpstream(undefined);

    if (!pending) {
      setStatus("idle");
      return;
    }

    const atIndex = pending.nip05.indexOf("@");
    if (atIndex === -1) {
      setStatus("error");
      return;
    }

    const name = pending.nip05.slice(0, atIndex);
    const domain = pending.nip05.slice(atIndex + 1);
    let cancelled = false;

    setStatus("loading");

    const resolveIdentity = async () => {
      await nip05WarmupReady;

      const cached = dnsIdentityLoader.getIdentity(name, domain);
      const identity =
        cached ?? (await dnsIdentityLoader.loadIdentity(name, domain));

      dnsIdentityLoader.identities.set(`${name}@${domain}`, identity);
      return identity;
    };

    resolveIdentity()
      .then((identity) => {
        if (cancelled) return;

        if (identity.status !== IdentityStatus.Found) {
          setStatus("not-found");
          return;
        }

        setResolvedUpstream({
          repository: repoCoordinate(identity.pubkey, pending.repoId),
          relayHint: pending.relayHint,
          authorPubkey: identity.pubkey,
          gitUrl: pending.gitUrl,
        });
        setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [pending]);

  return { status, resolvedUpstream };
}
