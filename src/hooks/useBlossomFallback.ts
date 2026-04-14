/**
 * useBlossomFallback — automatic fallback for Blossom media URLs.
 *
 * Blossom URLs are content-addressed (`/<sha256>[.ext]`). If the primary
 * server is unavailable, the same blob can be fetched from any other
 * configured Blossom server.
 *
 * Wire the returned `{ src, onError }` onto `<img>` or `<video>` elements.
 * Each time `onError` fires, `src` advances to the next candidate server.
 *
 * Usage:
 * ```tsx
 * function BlossomImage({ url }: { url: string }) {
 *   const { src, onError } = useBlossomFallback(url);
 *   return <img src={src} onError={onError} />;
 * }
 * ```
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";
import { UserBlossomServersModel } from "applesauce-common/models";
import { DEFAULT_BLOSSOM_SERVERS } from "@/lib/blossom";

/** SHA-256 hash pattern (64 hex chars) used in Blossom content-addressed URLs. */
const BLOSSOM_PATH_REGEX = /^\/([a-f0-9]{64})\b/;

/**
 * Given a media URL, provides fallback URLs from other configured Blossom servers.
 *
 * Returns `{ src, onError, failed }`:
 *   - `src`     — current URL to use (starts as `originalUrl`, advances on error)
 *   - `onError` — call this from the element's `onError` handler
 *   - `failed`  — true once all candidates have been exhausted
 */
export function useBlossomFallback(originalUrl: string) {
  const store = useEventStore();
  const account = useActiveAccount();
  const [fallbackIndex, setFallbackIndex] = useState(-1);
  const failedRef = useRef(false);

  // Reactively subscribe to the user's blossom server list (kind 10063)
  const blossomServers = use$(
    () =>
      account?.pubkey
        ? store.model(UserBlossomServersModel, account.pubkey)
        : undefined,
    [account?.pubkey, store],
  );

  const servers = useMemo(() => {
    if (blossomServers && blossomServers.length > 0) {
      return blossomServers.map((s) => s.toString());
    }
    return DEFAULT_BLOSSOM_SERVERS;
  }, [blossomServers]);

  // Build the list of alternative URLs from configured Blossom servers.
  // Only applies if the URL path looks like a content-addressed blob (/<sha256>...).
  const alternatives = useMemo(() => {
    try {
      const parsed = new URL(originalUrl);
      if (!BLOSSOM_PATH_REGEX.test(parsed.pathname)) return [];

      const origin = parsed.origin;
      return servers
        .filter((server) => {
          try {
            return new URL(server).origin !== origin;
          } catch {
            return false;
          }
        })
        .map((server) => {
          const base = new URL(server);
          return `${base.origin}${parsed.pathname}${parsed.search}`;
        });
    } catch {
      return [];
    }
  }, [originalUrl, servers]);

  const src =
    fallbackIndex < 0
      ? originalUrl
      : (alternatives[fallbackIndex] ?? originalUrl);

  const onError = useCallback(() => {
    if (alternatives.length === 0) return;

    setFallbackIndex((prev) => {
      const next = prev + 1;
      if (next < alternatives.length) {
        return next;
      }
      if (!failedRef.current) {
        failedRef.current = true;
      }
      return prev;
    });
  }, [alternatives]);

  return {
    src,
    onError,
    failed: failedRef.current && fallbackIndex >= alternatives.length - 1,
  };
}
