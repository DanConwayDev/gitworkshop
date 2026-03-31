/**
 * StarButton — star / unstar a repository.
 *
 * Publishes a kind:7 reaction with content "+" targeting the selected
 * maintainer's announcement event. Unstarring sends a NIP-09 deletion
 * request for the user's existing star event.
 *
 * The star count is deduplicated across all maintainer announcements so a
 * user who starred multiple announcements for the same repo is counted once.
 *
 * When no account is logged in, clicking opens the auth modal instead of
 * being disabled.
 */

import { useCallback, useState } from "react";
import { Star } from "lucide-react";
import { useActiveAccount } from "applesauce-react/hooks";
import { runner } from "@/services/actions";
import { CreateReaction, DeleteEvent } from "@/actions/nip34";
import { useRepoStars } from "@/hooks/useRepoStars";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { cn } from "@/lib/utils";
import type { NostrEvent } from "nostr-tools";

interface StarButtonProps {
  /**
   * The announcement event to star. Should be the selected maintainer's
   * kind:30617 event — the one the user is currently viewing.
   */
  targetAnnouncement: NostrEvent | undefined;
  /**
   * All announcement events for this repo (used for the deduplicated count).
   */
  allAnnouncements: NostrEvent[] | undefined;
  /** Repo relay URLs for publishing. */
  repoRelays: string[];
  /** Repo coordinate strings for relay group keying. */
  repoCoords: string[];
  className?: string;
}

export function StarButton({
  targetAnnouncement,
  allAnnouncements,
  repoRelays,
  repoCoords,
  className,
}: StarButtonProps) {
  const account = useActiveAccount();
  const { openAuthModal } = useAuthModal();
  const { count, isStarred, myStarEvent } = useRepoStars(allAnnouncements);
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(async () => {
    if (pending) return;
    if (!account) {
      openAuthModal();
      return;
    }
    if (!targetAnnouncement) return;
    setPending(true);
    try {
      if (isStarred && myStarEvent) {
        // Unstar: send a NIP-09 deletion request for the existing star event.
        await runner.run(DeleteEvent, [myStarEvent], repoRelays, repoCoords);
      } else if (!isStarred) {
        // Star: publish a "+" reaction targeting the selected announcement.
        await runner.run(
          CreateReaction,
          targetAnnouncement,
          "+",
          repoRelays,
          repoCoords,
        );
      }
    } catch (err) {
      console.error("[StarButton] failed:", err);
    } finally {
      setPending(false);
    }
  }, [
    account,
    openAuthModal,
    targetAnnouncement,
    pending,
    isStarred,
    myStarEvent,
    repoRelays,
    repoCoords,
  ]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!targetAnnouncement || pending}
      title={isStarred ? "Unstar this repository" : "Star this repository"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        isStarred
          ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-400 hover:bg-amber-400/20"
          : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        className,
      )}
      aria-pressed={isStarred}
    >
      <Star
        className={cn(
          "h-3.5 w-3.5 transition-colors",
          isStarred && "fill-amber-500 text-amber-500",
        )}
      />
      <span>Star</span>
      {count > 0 && (
        <span
          className={cn(
            "tabular-nums",
            isStarred
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
