/**
 * StarButton — star / unstar a repository, with a stargazers popover.
 *
 * Publishes a kind:7 reaction with content "+" targeting the selected
 * maintainer's announcement event. Unstarring sends a NIP-09 deletion
 * request for the user's existing star event.
 *
 * The star count is deduplicated across all maintainer announcements so a
 * user who starred multiple announcements for the same repo is counted once.
 *
 * Clicking the count opens a popover listing all stargazers.
 *
 * When the URL contains ?stargazer=<pubkey> (set by the nevent permalink
 * redirect in NIP19Page), the popover opens automatically and scrolls to /
 * highlights that specific stargazer. The param is removed from the URL
 * after the popover opens so it doesn't persist on refresh.
 *
 * When no account is logged in, clicking opens the auth modal instead of
 * being disabled.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { useActiveAccount } from "applesauce-react/hooks";
import { runner } from "@/services/actions";
import { CreateReaction, DeleteEvent } from "@/actions/nip34";
import { useRepoStars } from "@/hooks/useRepoStars";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { cn } from "@/lib/utils";
import type { NostrEvent } from "nostr-tools";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserLink } from "@/components/UserAvatar";
import { useSearchParams } from "react-router-dom";

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
  /** Repo coordinate strings for relay group keying. */
  repoCoords: string[];
  className?: string;
}

export function StarButton({
  targetAnnouncement,
  allAnnouncements,
  repoCoords,
  className,
}: StarButtonProps) {
  const account = useActiveAccount();
  const { openAuthModal } = useAuthModal();
  const { count, isStarred, myStarEvent, stargazers } =
    useRepoStars(allAnnouncements);
  const [pending, setPending] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Captured separately so it survives after the URL param is cleared.
  const [highlightPubkey, setHighlightPubkey] = useState<string | undefined>(
    () => searchParams.get("stargazer") ?? undefined,
  );
  const highlightRef = useRef<HTMLDivElement>(null);

  // When a ?stargazer= param is present, capture it, open the popover, then
  // remove the param from the URL so it doesn't persist on refresh.
  useEffect(() => {
    const param = searchParams.get("stargazer");
    if (param) {
      setHighlightPubkey(param);
      setPopoverOpen(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("stargazer");
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  // Scroll the highlighted row into view once the popover content mounts.
  useEffect(() => {
    if (popoverOpen && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [popoverOpen]);

  const handleStarClick = useCallback(async () => {
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
        await runner.run(DeleteEvent, [myStarEvent], repoCoords);
      } else if (!isStarred) {
        // Star: publish a "+" reaction targeting the selected announcement.
        await runner.run(CreateReaction, targetAnnouncement, "+", repoCoords);
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
    repoCoords,
  ]);

  const starBtnClass = cn(
    "inline-flex items-center gap-1.5 rounded-l-md border px-2.5 py-1 text-sm font-medium transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    isStarred
      ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-400 hover:bg-amber-400/20"
      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    // When there's no count, round both sides
    count === 0 && "rounded-r-md",
    className,
  );

  const countBtnClass = cn(
    "inline-flex items-center rounded-r-md border-y border-r px-2 py-1 text-sm font-medium tabular-nums transition-colors",
    isStarred
      ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-400 hover:bg-amber-400/20"
      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );

  return (
    <div className={cn("inline-flex", className)}>
      {/* Star / unstar action */}
      <button
        type="button"
        onClick={handleStarClick}
        disabled={!targetAnnouncement || pending}
        title={isStarred ? "Unstar this repository" : "Star this repository"}
        className={starBtnClass}
        aria-pressed={isStarred}
      >
        <Star
          className={cn(
            "h-3.5 w-3.5 transition-colors",
            isStarred && "fill-amber-500 text-amber-500",
          )}
        />
        <span>Star</span>
      </button>

      {/* Count — opens stargazers popover */}
      {count > 0 && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={countBtnClass}>
              {count}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-56 p-0"
            aria-label="Stargazers"
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground">
                {count} {count === 1 ? "stargazer" : "stargazers"}
              </p>
            </div>
            <ScrollArea className="max-h-64">
              <div className="py-1">
                {stargazers.map((pubkey) => {
                  const isHighlighted = pubkey === highlightPubkey;
                  return (
                    <div
                      key={pubkey}
                      ref={isHighlighted ? highlightRef : undefined}
                      className={cn(
                        "px-3 py-1.5 transition-colors",
                        isHighlighted &&
                          "bg-amber-400/15 ring-1 ring-inset ring-amber-400/40 rounded-sm",
                      )}
                    >
                      <UserLink
                        pubkey={pubkey}
                        avatarSize="sm"
                        nameClassName="text-sm"
                      />
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
