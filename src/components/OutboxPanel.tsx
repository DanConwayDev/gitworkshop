/**
 * OutboxPanel — displays the publish queue with per-relay status.
 *
 * Shows all events that have been published (or are pending publish) with
 * a breakdown of which relays succeeded and which failed. Failed relays are
 * retried automatically by the outbox store.
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

function itemStatus(
  item: OutboxItem,
): "success" | "partial" | "pending" | "failed" {
  const anySuccess = item.relayLogs.some((l) => l.success);
  const anyPending = item.relayLogs.some(
    (l) => !l.success && l.attempts.length === 0,
  );
  const anyFailed = item.relayLogs.some(
    (l) => !l.success && l.attempts.length > 0,
  );

  if (item.broadlySent) return "success";
  if (anySuccess && (anyPending || anyFailed)) return "partial";
  if (anyPending) return "pending";
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
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  }
}

function RelayLogRow({ log }: { log: OutboxItem["relayLogs"][number] }) {
  const lastAttempt = log.attempts[log.attempts.length - 1];
  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      {log.success ? (
        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
      ) : log.attempts.length === 0 ? (
        <Clock className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 animate-pulse" />
      ) : (
        <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-mono text-muted-foreground truncate block">
          {log.url}
        </span>
        {lastAttempt && !log.success && lastAttempt.msg && (
          <span className="text-destructive/80 truncate block">
            {lastAttempt.msg}
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

  // Group relay logs by their group label
  const groups = item.relayLogs.reduce<Record<string, OutboxItem["relayLogs"]>>(
    (acc, log) => {
      (acc[log.group] ??= []).push(log);
      return acc;
    },
    {},
  );

  return (
    <div
      className={
        "border-b last:border-b-0 " +
        (status === "failed"
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
          {Object.entries(groups).map(([group, logs]) => (
            <div key={group}>
              <div className="text-xs font-medium text-muted-foreground mb-1 capitalize">
                {group}
              </div>
              <div className="space-y-0.5">
                {logs.map((log) => (
                  <RelayLogRow key={log.url} log={log} />
                ))}
              </div>
            </div>
          ))}
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
    i.relayLogs.every((l) => !l.success && l.attempts.length > 0),
  ).length;

  const filtered = items.filter((item) => {
    if (filter === "pending") return !item.broadlySent;
    if (filter === "failed")
      return item.relayLogs.every((l) => !l.success && l.attempts.length > 0);
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
