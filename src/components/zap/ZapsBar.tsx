/**
 * ZapsBar — NIP-57 (kind:9735) zap totals for NIP-34 thread events.
 *
 * Mirrors the ReactionsBar layout:
 *   - Collapsed: amber ⚡ pill showing the total sats (clickable to expand) +
 *     a faint ⚡ ghost button to send a new zap
 *   - Expanded: per-zapper cards (sender avatar + amount) + close button
 *
 * Uses EventZapsModel (applesauce-common/models) to subscribe reactively to
 * zap receipts from the EventStore.
 */

import { useState, useMemo } from "react";
import type { NostrEvent } from "nostr-tools";
import {
  getZapAmount,
  getZapSender,
  isValidZap,
} from "applesauce-common/helpers";
import { EventZapsModel } from "applesauce-common/models";
import { useActiveAccount } from "applesauce-react/hooks";
import { Zap, X } from "lucide-react";

import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { useUser } from "@/hooks/useUser";
import { getRecipientLnurl } from "@/lib/zap";
import { UserLink } from "@/components/UserAvatar";
import { ZapModal } from "@/components/zap/ZapModal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ZapsBar
// ---------------------------------------------------------------------------

interface ZapsBarProps {
  event: NostrEvent;
  className?: string;
}

export function ZapsBar({ event, className }: ZapsBarProps) {
  const store = useEventStore();
  const account = useActiveAccount();

  // Subscribe reactively to zap receipts for this event
  const zapEvents = use$(
    () => store.model(EventZapsModel, event),
    [event, store],
  );

  // Filter to valid zaps and extract sender + sats
  const zaps = useMemo(() => {
    if (!zapEvents) return [];
    return zapEvents
      .filter(isValidZap)
      .map((ev) => ({
        event: ev,
        sender: getZapSender(ev),
        amountSats: Math.floor((getZapAmount(ev) ?? 0) / 1000),
      }))
      .filter((z) => z.amountSats > 0)
      .sort((a, b) => b.amountSats - a.amountSats);
  }, [zapEvents]);

  const totalSats = useMemo(
    () => zaps.reduce((sum, z) => sum + z.amountSats, 0),
    [zaps],
  );

  // Resolve recipient lightning address (for ZapModal)
  const recipient = useUser(event.pubkey);
  const profile = use$(() => recipient?.profile$, [recipient]);
  const lnurl = getRecipientLnurl(profile);

  const [expanded, setExpanded] = useState(false);
  const [zapModalOpen, setZapModalOpen] = useState(false);

  // Determine disabled state for the zap button
  const isSelf = account?.pubkey === event.pubkey;
  let disabledReason: string | null = null;
  if (!account) disabledReason = "Sign in to zap";
  // Only report "no lightning address" once the profile has actually loaded
  // (profile === undefined means still loading; null/object means loaded)
  else if (profile !== undefined && !lnurl)
    disabledReason = "Recipient has no lightning address";

  // Hide entirely when nothing to show and not able to interact
  if (totalSats === 0 && (!account || isSelf)) return null;

  const zapBtn = (
    <button
      type="button"
      disabled={!!disabledReason}
      onClick={() => setZapModalOpen(true)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/40 px-2 py-0.5",
        "text-xs text-amber-500/50 hover:text-amber-500 hover:border-amber-400/60",
        "transition-colors disabled:opacity-40",
      )}
      aria-label="Send zap"
    >
      <Zap className="h-3 w-3" />
    </button>
  );

  return (
    <>
      {expanded ? (
        <div
          className={cn(
            "flex flex-col gap-2 w-full bg-muted/40 rounded-lg p-3",
            className,
          )}
        >
          {/* Expanded: per-zapper cards */}
          {zaps.length > 0 && (
            <div className="flex flex-col gap-2">
              {zaps.map((z) => (
                <ZapperCard
                  key={z.event.id}
                  sender={z.sender}
                  amountSats={z.amountSats}
                />
              ))}
            </div>
          )}

          {/* Bottom row: zap button + close — mirrors ReactionsBar picker row */}
          <div className="flex flex-wrap items-center gap-1">
            {account &&
              !isSelf &&
              (disabledReason ? (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <button
                          type="button"
                          disabled
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
                            "text-xs font-medium border-amber-400/50 bg-amber-500/15 text-amber-600",
                            "dark:border-amber-500/40 dark:text-amber-400",
                            "disabled:opacity-40",
                          )}
                          aria-label="Send zap"
                        >
                          <Zap className="h-3 w-3" />
                          Zap
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{disabledReason}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <button
                  type="button"
                  onClick={() => setZapModalOpen(true)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
                    "text-xs font-medium border-amber-400/50 bg-amber-500/15 text-amber-600",
                    "dark:border-amber-500/40 dark:text-amber-400",
                    "hover:bg-amber-500/25 hover:border-amber-400/70 transition-colors",
                  )}
                  aria-label="Send zap"
                >
                  <Zap className="h-3 w-3" />
                  Zap
                </button>
              ))}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded border border-border/30 p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              aria-label="Collapse zap details"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : (
        <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
          {/* Collapsed sats pill — only when there are zaps */}
          {totalSats > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                "border-amber-200/70 bg-amber-50/30 text-amber-600",
                "dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-400",
                "hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors",
              )}
              aria-label={`${totalSats.toLocaleString()} sats in zaps — click to expand`}
            >
              <Zap className="h-3 w-3" />
              <span>{totalSats.toLocaleString()}</span>
            </button>
          )}

          {/* Zap button — hidden for own events */}
          {account &&
            !isSelf &&
            (disabledReason ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>{zapBtn}</span>
                  </TooltipTrigger>
                  <TooltipContent>{disabledReason}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              zapBtn
            ))}
        </div>
      )}

      {/* ZapModal — only mount when viable */}
      {account && !isSelf && lnurl && (
        <ZapModal
          open={zapModalOpen}
          onOpenChange={setZapModalOpen}
          event={event}
          lnurl={lnurl}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ZapperCard — individual zapper: amount pill + sender link
// ---------------------------------------------------------------------------

function ZapperCard({
  sender,
  amountSats,
}: {
  sender: string | undefined;
  amountSats: number;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-amber-200/40 overflow-hidden">
      {/* Amount */}
      <div className="px-2.5 py-1 bg-amber-50/20 dark:bg-amber-950/20 text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
        <Zap className="h-3 w-3 shrink-0" />
        <span>{amountSats.toLocaleString()}</span>
      </div>
      {/* Sender */}
      {sender && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-background/60">
          <UserLink pubkey={sender} avatarSize="sm" nameClassName="text-xs" />
        </div>
      )}
    </div>
  );
}
