/**
 * RepoZapButton — zap a repository, with a zappers popover.
 *
 * Clicking the left button opens the ZapModal targeting the selected
 * maintainer's announcement event (kind:30617). The right count button shows
 * the total sats zapped and, when clicked, opens a popover listing each
 * unique sender once with their cumulative total.
 *
 * Disabled states (tooltip):
 *   - No signed-in account → auth modal opens instead
 *   - No lightning address on the maintainer's profile → shown as disabled
 *   - Viewing your own repo (self) → shown as disabled
 *
 * Layout matches StarButton / FollowRepoButton — split pill: [Zap] [3,700 sats]
 */

import { useState } from "react";
import { Zap } from "lucide-react";
import { useActiveAccount } from "applesauce-react/hooks";
import type { NostrEvent } from "nostr-tools";

import { use$ } from "@/hooks/use$";
import { useUser } from "@/hooks/useUser";
import { useLoadProfile } from "@/hooks/useLoadProfile";
import { useRepoZaps } from "@/hooks/useRepoZaps";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { getRecipientLnurl } from "@/lib/zap";
import { cn, compactNumber } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserLink } from "@/components/UserAvatar";
import { ZapModal } from "@/components/zap/ZapModal";

interface RepoZapButtonProps {
  /**
   * The announcement event to zap. Should be the selected maintainer's
   * kind:30617 event — the one the user is currently viewing.
   */
  targetAnnouncement: NostrEvent | undefined;
  /** Repo coordinate strings used to count zaps across all maintainers. */
  repoCoords: string[] | undefined;
  className?: string;
}

export function RepoZapButton({
  targetAnnouncement,
  repoCoords,
  className,
}: RepoZapButtonProps) {
  const account = useActiveAccount();
  const { openAuthModal } = useAuthModal();

  // Load the target maintainer's profile to get their lightning address.
  const recipientPubkey = targetAnnouncement?.pubkey;
  useLoadProfile(recipientPubkey);
  const recipient = useUser(recipientPubkey);
  const profile = use$(() => recipient?.profile$, [recipient]);
  const lnurl = getRecipientLnurl(profile);

  const { totalSats, zappers } = useRepoZaps(repoCoords);
  const [zapModalOpen, setZapModalOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const isSelf = account?.pubkey === recipientPubkey;

  // profile === undefined means still loading; null/object means loaded.
  let disabledReason: string | null = null;
  if (!account)
    disabledReason = null; // will open auth modal
  else if (isSelf) disabledReason = "You can't zap your own repo";
  else if (profile !== undefined && !lnurl)
    disabledReason = "Maintainer has no lightning address";

  const canZap = !!account && !isSelf && !!lnurl && !!targetAnnouncement;

  const handleZapClick = () => {
    if (!account) {
      openAuthModal();
      return;
    }
    if (!canZap) return;
    setZapModalOpen(true);
  };

  const zapBtnClass = cn(
    "inline-flex items-center gap-1.5 rounded-l-md border px-2.5 py-1 text-sm font-medium transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    totalSats > 0
      ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-400 hover:bg-amber-400/20"
      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    totalSats === 0 && "rounded-r-md",
    className,
  );

  const countBtnClass = cn(
    "inline-flex items-center rounded-r-md border-y border-r px-2 py-1 text-sm font-medium tabular-nums transition-colors",
    totalSats > 0
      ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-400 hover:bg-amber-400/20"
      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );

  const zapButton = (
    <button
      type="button"
      onClick={handleZapClick}
      disabled={!!disabledReason}
      title={disabledReason ?? "Zap this repository"}
      className={zapBtnClass}
    >
      <Zap className="h-3.5 w-3.5 transition-colors" />
      <span className="hidden sm:inline">Zap</span>
    </button>
  );

  return (
    <>
      <div className={cn("inline-flex", className)}>
        {/* Zap action — wrapped in tooltip when disabled */}
        {disabledReason ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{zapButton}</span>
              </TooltipTrigger>
              <TooltipContent>{disabledReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          zapButton
        )}

        {/* Sats count — opens zappers popover */}
        {totalSats > 0 && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button type="button" className={countBtnClass}>
                {compactNumber(totalSats)}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-64 p-0"
              aria-label="Zappers"
            >
              <div className="px-3 py-2 border-b border-border flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <p className="text-xs font-medium text-muted-foreground">
                  {compactNumber(totalSats)} sats from{" "}
                  {zappers.length === 1
                    ? "1 zapper"
                    : `${zappers.length} zappers`}
                </p>
              </div>
              <ScrollArea className="max-h-64">
                <div className="py-1">
                  {zappers.map((z) => (
                    <div
                      key={z.pubkey}
                      className="px-3 py-1.5 flex items-center justify-between gap-2"
                    >
                      <UserLink
                        pubkey={z.pubkey}
                        avatarSize="sm"
                        nameClassName="text-sm"
                      />
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
                        {compactNumber(z.totalSats)}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* ZapModal — only mount when the full zap flow is viable */}
      {canZap && lnurl && (
        <ZapModal
          open={zapModalOpen}
          onOpenChange={setZapModalOpen}
          event={targetAnnouncement}
          lnurl={lnurl}
        />
      )}
    </>
  );
}
