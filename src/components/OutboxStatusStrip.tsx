/**
 * OutboxStatusBadge — inline send-status indicator for event cards.
 *
 * Renders next to the timestamp in the event header showing relay delivery
 * progress. Only shown for events authored by the currently logged-in user.
 * Silently returns null for other users' events or when not logged in.
 *
 * Clicking the badge opens a popover with the full per-relay breakdown
 * (the same detail view used in the Outbox panel in the header).
 *
 * One-liner labels:
 *   "publishing (0/5 relays)"        — nothing confirmed yet
 *   "partially published (1/5 relays)" — some confirmed, still sending
 *   "broadly published (3/5 relays)"  — broadlySent flag set
 *   "failed (0/5 relays)"             — all relays failed/permanent
 *
 * Usage — drop next to the timestamp in any event header:
 *   <OutboxStatusBadge event={nostrEvent} />
 */

import { useActiveAccount } from "applesauce-react/hooks";
import { CheckCircle2, Send, XCircle, Loader2 } from "lucide-react";
import { use$ } from "@/hooks/use$";
import { outboxStore, type OutboxItem } from "@/services/outbox";
import { cn } from "@/lib/utils";
import type { NostrEvent } from "nostr-tools";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { OutboxItemDetail } from "@/components/OutboxPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OutboxStatus = "publishing" | "broadly-published" | "partial" | "failed";

function outboxSummaryStatus(item: OutboxItem): OutboxStatus {
  if (item.broadlySent) return "broadly-published";
  // No relays yet — relay group resolution is still in progress
  if (item.relays.length === 0) return "publishing";
  const anyPending = item.relays.some(
    (r) => r.status === "pending" || r.status === "retrying",
  );
  const anySuccess = item.relays.some((r) => r.status === "success");
  if (anyPending) return anySuccess ? "partial" : "publishing";
  return "failed";
}

// ---------------------------------------------------------------------------
// StatusIcon — live animated indicator
// ---------------------------------------------------------------------------

function StatusIcon({
  status,
  className,
}: {
  status: OutboxStatus;
  className?: string;
}) {
  switch (status) {
    case "publishing":
      return (
        <Loader2
          className={cn("h-2.5 w-2.5 shrink-0 animate-spin", className)}
        />
      );
    case "partial":
      return (
        <Send className={cn("h-2.5 w-2.5 shrink-0 animate-pulse", className)} />
      );
    case "broadly-published":
      return <CheckCircle2 className={cn("h-2.5 w-2.5 shrink-0", className)} />;
    case "failed":
      return <XCircle className={cn("h-2.5 w-2.5 shrink-0", className)} />;
  }
}

// ---------------------------------------------------------------------------
// OutboxStatusBadge — sits inline next to the timestamp
// ---------------------------------------------------------------------------

export function OutboxStatusBadge({ event }: { event: NostrEvent }) {
  const account = useActiveAccount();
  const items = use$(outboxStore.items$) ?? [];

  // Only show for the logged-in user's own events
  if (!account || event.pubkey !== account.pubkey) return null;

  const item = items.find((i) => i.id === event.id);

  // Not in outbox, or hidden internal event — nothing to show
  if (!item || item.hidden) return null;

  const status = outboxSummaryStatus(item);
  const successCount = item.relays.filter((r) => r.status === "success").length;
  const totalCount = item.relays.length;

  const countSuffix = totalCount > 0 ? ` (${successCount}/${totalCount})` : "";
  const label = {
    publishing: `publishing...${countSuffix}`,
    partial: `publishing...${countSuffix}`,
    "broadly-published": "published",
    failed: `failed${countSuffix}`,
  }[status];

  const colorClass = {
    publishing: "text-yellow-600/80 dark:text-yellow-400/80",
    partial: "text-yellow-600/80 dark:text-yellow-400/80",
    "broadly-published": "text-green-600/80 dark:text-green-400/80",
    failed: "text-destructive/80",
  }[status];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 text-xs cursor-pointer hover:opacity-80 transition-opacity",
            colorClass,
          )}
          aria-label={`Relay delivery status: ${label}`}
        >
          <StatusIcon status={status} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 pb-1 border-b border-border">
            <StatusIcon status={status} className={colorClass} />
            <span className={cn("text-xs font-medium", colorClass)}>
              {label}
            </span>
          </div>
          <OutboxItemDetail item={item} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Keep old names as aliases so existing import sites still compile.
// ---------------------------------------------------------------------------

/** @deprecated Use OutboxStatusBadge instead */
export const OutboxStatusStrip = OutboxStatusBadge;
/** @deprecated Use OutboxStatusBadge instead */
export const OutboxStatusInline = OutboxStatusBadge;
