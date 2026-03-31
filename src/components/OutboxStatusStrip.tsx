/**
 * OutboxStatusStrip — inline send-status indicator for event cards.
 *
 * Renders next to the timestamp in the event header showing relay delivery
 * progress. Only shown for events authored by the currently logged-in user.
 * Silently returns null for other users' events or when not logged in.
 *
 * States:
 *   sending  — relays still pending (none succeeded yet)
 *   partial  — some relays succeeded, others still pending
 *   sent     — broadly sent: all groups covered
 *   failed   — all relays failed/permanent
 *
 * Usage — drop next to the timestamp in any event header:
 *   <OutboxStatusBadge event={nostrEvent} />
 */

import { useActiveAccount } from "applesauce-react/hooks";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { use$ } from "@/hooks/use$";
import { outboxStore, type OutboxItem } from "@/services/outbox";
import { cn } from "@/lib/utils";
import type { NostrEvent } from "nostr-tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OutboxStatus = "sending" | "sent" | "partial" | "failed";

function outboxSummaryStatus(item: OutboxItem): OutboxStatus {
  if (item.broadlySent) return "sent";
  const anyPending = item.relays.some(
    (r) => r.status === "pending" || r.status === "retrying",
  );
  const anySuccess = item.relays.some((r) => r.status === "success");
  if (anyPending) return anySuccess ? "partial" : "sending";
  return "failed";
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

  // Not in outbox — old event fetched from relay, nothing to show
  if (!item) return null;

  const status = outboxSummaryStatus(item);
  const successCount = item.relays.filter((r) => r.status === "success").length;
  const totalCount = item.relays.length;

  const label = {
    sending: `sending… ${successCount}/${totalCount}`,
    partial: `sending… ${successCount}/${totalCount}`,
    sent: `published ${successCount}/${totalCount}`,
    failed: `failed ${successCount}/${totalCount}`,
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        status === "sending" && "text-muted-foreground/60",
        status === "partial" && "text-yellow-600/80 dark:text-yellow-400/80",
        status === "sent" && "text-green-600/80 dark:text-green-400/80",
        status === "failed" && "text-destructive/80",
      )}
      title={
        status === "failed"
          ? "Failed to send to some relays — check outbox"
          : undefined
      }
    >
      {(status === "sending" || status === "partial") && (
        <Send className="h-2.5 w-2.5 shrink-0 animate-pulse" />
      )}
      {status === "sent" && <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />}
      {status === "failed" && <XCircle className="h-2.5 w-2.5 shrink-0" />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Keep old names as aliases so existing import sites still compile
// while we migrate them to use OutboxStatusBadge directly.
// ---------------------------------------------------------------------------

/** @deprecated Use OutboxStatusBadge instead */
export const OutboxStatusStrip = OutboxStatusBadge;
/** @deprecated Use OutboxStatusBadge instead */
export const OutboxStatusInline = OutboxStatusBadge;
