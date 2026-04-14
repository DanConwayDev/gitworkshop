/**
 * useBlossomUpload — upload a File to the user's configured Blossom servers.
 *
 * Reads the user's kind:10063 server list via UserBlossomServersModel and
 * falls back to https://blossom.band when none are configured.
 *
 * Uses nostr-tools' built-in BlossomClient (NIP-B7) which handles auth
 * header signing automatically via the account signer.
 *
 * Returns:
 *   uploadFile(file) — uploads and returns the public URL
 *   isUploading      — true while an upload is in flight
 */

import { useCallback, useState } from "react";
import { BlossomClient } from "nostr-tools/nipb7";
import type { Signer } from "nostr-tools/signer";
import { useActiveAccount } from "applesauce-react/hooks";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { UserBlossomServersModel } from "applesauce-common/models";
import { useToast } from "@/hooks/useToast";

const FALLBACK_SERVER = "https://blossom.band";

export function useBlossomUpload() {
  const account = useActiveAccount();
  const store = useEventStore();
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);

  // Reactively subscribe to the user's blossom server list (kind 10063)
  const blossomServers = use$(
    () =>
      account?.pubkey
        ? store.model(UserBlossomServersModel, account.pubkey)
        : undefined,
    [account?.pubkey, store],
  );

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      if (!account) {
        toast({
          title: "Not logged in",
          description: "You must be logged in to upload files.",
          variant: "destructive",
        });
        return null;
      }

      // Pick the first configured server or fall back
      const serverUrl =
        blossomServers && blossomServers.length > 0
          ? blossomServers[0].toString()
          : FALLBACK_SERVER;

      // Wrap the account signer in the shape BlossomClient expects.
      // Cast via unknown because applesauce returns NostrEvent while nostr-tools
      // Signer expects VerifiedEvent — the runtime shape is identical.
      const signer = {
        signEvent: (template: Parameters<Signer["signEvent"]>[0]) =>
          account.signer.signEvent(template) as ReturnType<Signer["signEvent"]>,
        getPublicKey: () => Promise.resolve(account.pubkey),
      } satisfies Signer;

      setIsUploading(true);
      try {
        const client = new BlossomClient(serverUrl, signer);
        const blob = await client.uploadFile(file);
        return blob.url;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        toast({
          title: "Upload failed",
          description: message,
          variant: "destructive",
        });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [account, blossomServers, toast],
  );

  return { uploadFile, isUploading };
}
