/**
 * useBlossomUpload — upload a File to the user's configured Blossom servers.
 *
 * Reads the user's kind:10063 server list via UserBlossomServersModel and
 * falls back to DEFAULT_BLOSSOM_SERVERS when none are configured.
 *
 * Features (matching ditto's useUploadFile):
 *   - Uploads to all configured servers simultaneously (Promise.any — fastest wins)
 *   - Mirrors the blob to remaining servers in the background (BUD-04)
 *   - 30-second per-server timeout
 *   - Returns full NIP-94 tags (url, x, ox, size, m, dim, blurhash) for imeta injection
 *   - Appends file extension to content-addressed URLs if missing
 *
 * Returns:
 *   uploadFile(file) — uploads and returns NIP-94 tags (or null on failure)
 *   isUploading      — true while an upload is in flight
 */

import { useCallback, useState } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { UserBlossomServersModel } from "applesauce-common/models";
import { useToast } from "@/hooks/useToast";
import {
  blossomUpload,
  DEFAULT_BLOSSOM_SERVERS,
  type Nip94Tags,
  type BlossomSigner,
} from "@/lib/blossom";
import type { EventTemplate } from "nostr-tools";

export type { Nip94Tags };

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
    async (file: File): Promise<Nip94Tags | null> => {
      if (!account) {
        toast({
          title: "Not logged in",
          description: "You must be logged in to upload files.",
          variant: "destructive",
        });
        return null;
      }

      // Use configured servers or fall back to defaults
      const servers =
        blossomServers && blossomServers.length > 0
          ? blossomServers.map((s) => s.toString())
          : DEFAULT_BLOSSOM_SERVERS;

      // Wrap the applesauce signer into the shape blossomUpload expects.
      // The runtime shape is identical — the cast is purely for TypeScript.
      const signer: BlossomSigner = {
        signEvent: (template: EventTemplate) =>
          account.signer.signEvent(template) as ReturnType<
            BlossomSigner["signEvent"]
          >,
        getPublicKey: () => Promise.resolve(account.pubkey),
      };

      setIsUploading(true);
      try {
        return await blossomUpload(file, servers, signer);
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
