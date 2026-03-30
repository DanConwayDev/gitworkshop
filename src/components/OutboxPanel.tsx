/**
 * OutboxPanel — displays the publish queue with per-relay status.
 *
 * Shows all events that have been published (or are pending publish) with
 * a breakdown of which relays succeeded and which failed. Failed relays are
 * retried automatically by the outbox store (unless permanently rejected).
 *
 * Relay groups use semantic IDs:
 *   - 64-char hex pubkey → "your outbox" (if own pubkey) or "<name>'s inbox"
 *   - "30617:<pubkey>:<d>" → repo relay coord
 *   - Other strings → displayed as-is
 */

import { use$ } from "@/hooks/use$";
import { outboxStore, type OutboxItem } from "@/services/outbox";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  Clock,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  LABEL_KIND,
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
  COMMENT_KIND,
} from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindLabel(kind: number): string {
  switch (kind) {
    case ISSUE_KIND:
      return "Issue";
    case PATCH_KIND:
      return "Patch";
    case PR_KIND:
      return "PR";
    case LABEL_KIND:
      return "Label";
    case STATUS_OPEN:
      return "Status: Open";
    case STATUS_RESOLVED:
      return "Status: Resolved";
    case STATUS_CLOSED:
      return "Status: Closed";
    case STATUS_DRAFT:
      return "Status: Draft";
    case COMMENT_KIND:
      return "Comment";
    case 0:
      return "Profile";
    case 1:
      return "Note";
    case 3:
      return "Contacts";
    case 10002:
      return "Relay List";
    default:
      return `Kind ${kind}`;
  }
}

/**
 * Render a human-readable label for a relay group ID.
 *
 * Group IDs follow the convention in OutboxRelayLog.groups:
 *   - 64-char hex pubkey → "your outbox" (own) or "inbox: <short pubkey>"
 *   - "30617:<pubkey>:<d>" → "repo: <d>"
 *   - Other strings → displayed as-is
 */
function groupLabel(groupId: string, eventPubkey: string): string {
  if (/^[0-9a-f]{64}$/.test(groupId)) {
    if (groupId === eventPubkey) return "your outbox";
    return `inbox: ${groupId.slice(0, 8)}…`;
  }
  if (groupId.startsWith("30617:")) {
    const parts = groupId.split(":");
    const d = parts[2] ?? groupId;
    return `repo: ${d}`;
  }
  return groupId;
}

function itemStatus(
  item: OutboxItem,
): "success" | "partial" | "pending" | "failed" | "permanent" {
  const anySuccess = item.relayLogs.some((l) => l.success);
  const anyPermanent = item.relayLogs.some(
    (l) => l.permanentFailure && !l.success,
  );
  const anyPending = item.relayLogs.some(
    (l) => !l.success && !l.permanentFailure && l.attempts.length === 0,
  );
  const anyRetrying = item.relayLogs.some(
    (l) => !l.success && !l.permanentFailure && l.tryAfterTimestamp,
  );

  if (item.broadlySent) return "success";
  if (anySuccess && (anyPending || anyRetrying)) return "partial";
  if (anyPending || anyRetrying) return "pending";
  if (anyPermanent && !anySuccess) return "permanent";
  return "failed";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: ReturnType<typeof itemStatus> }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "partial":
      return <CheckCircle2 className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "pending":
      return (
        <Clock className="h-4 w-4 text-muted-foreground shrink-0 animate-pulse" />
      );
    case "permanent":
      return <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  }
}

function RelayLogRow({ log }: { log: OutboxItem["relayLogs"][number] }) {
  const lastAttempt = log.attempts[log.attempts.length - 1];
  const isPermanent = !!log.permanentFailure && !log.success;
  const isRetrying =
    !log.success && !log.permanentFailure && !!log.tryAfterTimestamp;

  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      {log.success ? (
        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
      ) : isPermanent ? (
        <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0 mt-0.5" />
      ) : log.attempts.length === 0 || isRetrying ? (
        <Clock className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 animate-pulse" />
      ) : (
        <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-mono text-muted-foreground truncate block">
          {log.url}
        </span>
        {isPermanent && (
          <span className="text-orange-500/80 truncate block">
            {log.permanentFailure}
          </span>
        )}
        {!log.success && !isPermanent && lastAttempt?.msg && (
          <span className="text-destructive/80 truncate block">
            {isRetrying ? `retrying… (${lastAttempt.msg})` : lastAttempt.msg}
          </span>
        )}
      </div>
    </div>
  );
}

function OutboxItemRow({ item }: { item: OutboxItem }) {
  const [expanded, setExpanded] = useState(false);
  const status = itemStatus(item);
  const successCount = item.relayLogs.filter((l) => l.success).length;
  const totalCount = item.relayLogs.length;

  // Collect all unique group IDs across all relay logs
  const allGroupIds = [...new Set(item.relayLogs.flatMap((l) => l.groups))];

  return (
    <div
      className={
        "border-b last:border-b-0 " +
        (status === "failed" || status === "permanent"
          ? "bg-destructive/5"
          : status === "partial"
            ? "bg-yellow-500/5"
            : "")
      }
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusIcon status={status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs py-0 h-5 shrink-0">
              {kindLabel(item.event.kind)}
            </Badge>
            <span className="text-xs text-muted-foreground truncate">
              {formatDistanceToNow(new Date(item.createdAt * 1000), {
                addSuffix: true,
              })}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {successCount}/{totalCount} relays
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => outboxStore.dismiss(item.id)}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {allGroupIds.map((groupId) => {
            const logsForGroup = item.relayLogs.filter((l) =>
              l.groups.includes(groupId),
            );
            const label = groupLabel(groupId, item.event.pubkey);
            const groupSuccess = logsForGroup.filter((l) => l.success).length;
            return (
              <div key={groupId}>
                <div className="text-xs font-medium text-muted-foreground mb-1 capitalize flex items-center gap-1">
                  <span>{label}</span>
                  <span className="text-muted-foreground/60">
                    ({groupSuccess}/{logsForGroup.length})
                  </span>
                </div>
                <div className="space-y-0.5">
                  {logsForGroup.map((log) => (
                    <RelayLogRow key={log.url} log={log} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type FilterMode = "all" | "pending" | "failed";

export function OutboxPanel() {
  const items = use$(outboxStore.items$) ?? [];
  const [filter, setFilter] = useState<FilterMode>("all");

  const pendingCount = items.filter((i) => !i.broadlySent).length;
  const failedCount = items.filter((i) =>
    i.relayLogs.every(
      (l) => (!l.success && l.attempts.length > 0) || l.permanentFailure,
    ),
  ).length;

  const filtered = items.filter((item) => {
    if (filter === "pending") return !item.broadlySent;
    if (filter === "failed")
      return item.relayLogs.every(
        (l) => (!l.success && l.attempts.length > 0) || l.permanentFailure,
      );
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-sm font-medium flex-1">Outbox</span>
        <div className="flex gap-1">
          <Button
            variant={filter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setFilter("all")}
          >
            All ({items.length})
          </Button>
          <Button
            variant={filter === "pending" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setFilter("pending")}
          >
            Pending
            {pendingCount > 0 && (
              <Badge
                variant="destructive"
                className="ml-1 h-4 min-w-4 px-1 text-xs"
              >
                {pendingCount}
              </Badge>
            )}
          </Button>
          <Button
            variant={filter === "failed" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setFilter("failed")}
          >
            Failed
            {failedCount > 0 && (
              <Badge
                variant="destructive"
                className="ml-1 h-4 min-w-4 px-1 text-xs"
              >
                {failedCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
            {filter === "all" ? "No published events yet" : "Nothing here"}
          </div>
        ) : (
          filtered.map((item) => <OutboxItemRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

/**
 * Badge showing the count of pending (not broadly sent) outbox items.
 * Returns null when everything is sent.
 */
export function OutboxPendingBadge() {
  const items = use$(outboxStore.items$) ?? [];
  const pendingCount = items.filter((i) => !i.broadlySent).length;

  if (pendingCount === 0) return null;

  return (
    <Badge variant="destructive" className="h-4 min-w-4 px-1 text-xs">
      {pendingCount}
    </Badge>
  );
}
