import { useState, useCallback, useEffect, useMemo } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { useSeoMeta } from "@unhead/react";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Bell,
  Archive,
  Inbox,
  List,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from "lucide-react";
import {
  NotificationRow,
  NotificationSkeleton,
  type ViewTab,
} from "@/components/NotificationRow";

const ITEMS_PER_PAGE = 10;

export default function NotificationsPage() {
  const activeAccount = useActiveAccount();
  const { items, unreadCount, actions, history } = useNotifications();
  const [currentView, setCurrentView] = useState<ViewTab>("inbox");
  const [currentPage, setCurrentPage] = useState(1);

  useSeoMeta({
    title:
      unreadCount > 0
        ? `(${unreadCount}) Notifications - ngit`
        : "Notifications - ngit",
    description: "Your notification inbox",
  });

  // Filter items by current view
  const filteredItems = useMemo(() => {
    if (!items) return undefined;
    switch (currentView) {
      case "inbox":
        return items.filter((item) => !item.archived);
      case "archived":
        return items.filter((item) => item.archived);
      case "all":
        return items;
    }
  }, [items, currentView]);

  // Pagination — reset currentPage when the list shrinks past it (#10)
  const totalPages = filteredItems
    ? Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE))
    : 1;
  const safePage = Math.min(currentPage, totalPages);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const pageItems = filteredItems?.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  );

  // Reset page when switching tabs
  const handleTabChange = useCallback((tab: ViewTab) => {
    setCurrentView(tab);
    setCurrentPage(1);
  }, []);

  if (!activeAccount) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-16">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <Bell className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            Sign in to see your notifications
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>

        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
          <TabButton
            active={currentView === "inbox"}
            onClick={() => handleTabChange("inbox")}
            icon={Inbox}
            label="Inbox"
            badge={unreadCount > 0 ? unreadCount : undefined}
          />
          <TabButton
            active={currentView === "archived"}
            onClick={() => handleTabChange("archived")}
            icon={Archive}
            label="Archived"
          />
          <TabButton
            active={currentView === "all"}
            onClick={() => handleTabChange("all")}
            icon={List}
            label="All"
          />
        </div>
      </div>

      {/* Bulk actions bar */}
      <div className="flex items-center justify-end gap-2 mb-2 min-h-[32px]">
        {currentView === "inbox" &&
          filteredItems &&
          filteredItems.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={actions.markAllAsRead}
              >
                <Check className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={actions.markAllAsArchived}
              >
                <Archive className="h-3 w-3 mr-1" />
                Archive all
              </Button>
            </>
          )}
      </div>

      {/* Notification list */}
      <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
        {!filteredItems || (filteredItems.length === 0 && history.loading) ? (
          // Loading skeleton — also shown when list is empty but still fetching
          // to avoid a flash of the empty state before the first page arrives
          <ul className="divide-y divide-border/40">
            {Array.from({ length: 2 }).map((_, i) => (
              <NotificationSkeleton key={i} />
            ))}
          </ul>
        ) : filteredItems.length === 0 ? (
          // Empty state
          <div className="py-16 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-3">
              {currentView === "inbox" ? (
                <>
                  <Inbox className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">
                    Your inbox is empty. Notifications appear when someone
                    interacts with your repositories.
                  </p>
                </>
              ) : currentView === "archived" ? (
                <>
                  <Archive className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">
                    No archived notifications.
                  </p>
                </>
              ) : (
                <>
                  <Bell className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">
                    No notifications yet.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {pageItems?.map((item) => (
              <NotificationRow
                key={item.rootId}
                item={item}
                actions={actions}
                currentView={currentView}
              />
            ))}
          </ul>
        )}
      </div>

      {/* History load-more / spinner */}
      {/* On the inbox tab, hide load more once we've fetched all non-archived
          events (reachedArchive). On archived/all tabs always show it so the
          user can page through archived history. */}
      {(history.loading ||
        (history.hasMore &&
          !(currentView === "inbox" && history.reachedArchive))) && (
        <div className="flex justify-center mt-3">
          {history.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading older notifications…
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={history.loadMore}
            >
              Load more
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === 1}
            onClick={() => setCurrentPage(1)}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) =>
                p === safePage ||
                (p >= Math.max(1, safePage - 2) &&
                  p <= Math.min(totalPages, safePage + 2)),
            )
            .map((p) => (
              <Button
                key={p}
                variant={p === safePage ? "default" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setCurrentPage(p)}
              >
                {p}
              </Button>
            ))}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {badge !== undefined && (
        <Badge
          variant="secondary"
          className="h-4 min-w-[16px] px-1 text-[10px] leading-none"
        >
          {badge}
        </Badge>
      )}
    </button>
  );
}
