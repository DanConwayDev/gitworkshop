/**
 * Recursive thread tree renderer.
 *
 * Takes a ThreadTreeNode (from src/lib/threadTree.ts) and renders it as a
 * nested, collapsible thread — similar to gitworkshop.dev's ThreadTree.svelte.
 *
 * The data structure is decoupled from the UI: the tree is built by pure
 * functions in threadTree.ts, and this component only handles rendering.
 * Swapping to a different layout (flat, side-by-side, etc.) only requires
 * changing this file.
 *
 * Visual approach: the thread's left border line IS the container — individual
 * comments don't get their own Card border. Each comment is separated by a
 * subtle top border. This keeps deep threads compact (matching gitworkshop).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Calendar,
  Reply,
  Trash2,
} from "lucide-react";
import type { NostrEvent } from "nostr-tools";
import type { ThreadTreeNode } from "@/lib/threadTree";
import { countDescendants } from "@/lib/threadTree";
import { UserLink } from "@/components/UserAvatar";
import { EventCardActions } from "@/components/EventCardActions";
import { CommentContent } from "@/components/CommentContent";
import { ReplyBox } from "@/components/ReplyBox";
import type { ThreadContext } from "@/components/EventThreadComponents";
import { OutboxStatusBadge } from "@/components/OutboxStatusStrip";
import { ReactionsBar } from "@/components/ReactionsBar";
import { useActiveAccount } from "applesauce-react/hooks";
import { DeleteEvent } from "@/actions/nip34";
import { runner } from "@/services/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Thread context — passes root info down without prop-drilling
// ---------------------------------------------------------------------------

const ThreadCtx = createContext<ThreadContext | null>(null);

// ---------------------------------------------------------------------------
// Depth-based color palette
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ThreadTreeProps {
  /** The tree node to render (and its descendants). */
  node: ThreadTreeNode;
  /**
   * Whether this is the root node of the thread (the issue/PR body itself).
   * When true, the node's own event is NOT rendered — only its children.
   * The caller is expected to render the root event separately (e.g. as an
   * EventBodyCard).
   */
  isRoot?: boolean;
  /**
   * Custom renderer for a single event node. Defaults to the built-in
   * borderless ThreadComment. This allows the caller to render different
   * event kinds differently (e.g. reactions, status changes) without
   * modifying this component.
   */
  renderEvent?: (event: NostrEvent, node: ThreadTreeNode) => React.ReactNode;
  /**
   * Filter predicate for child nodes. Return false to exclude a child
   * from rendering (e.g. to filter out kind:7 reactions that are shown
   * inline on the parent). Defaults to including all children.
   */
  filterChildren?: (node: ThreadTreeNode) => boolean;
  /**
   * Current nesting depth. Used to fade the left border line — deeper
   * threads get a more subtle line. Clamped so it never disappears entirely.
   */
  depth?: number;
  /**
   * Root context for inline reply composers. Required at the top level;
   * propagated automatically to nested nodes via context.
   */
  threadContext?: ThreadContext;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThreadTree({
  node,
  isRoot = false,
  renderEvent,
  filterChildren,
  depth = 0,
  threadContext,
}: ThreadTreeProps) {
  const visibleChildren = filterChildren
    ? node.children.filter(filterChildren)
    : node.children;

  const inner = (
    <div>
      {/* Render this node's event (unless it's the root — caller handles that) */}
      {!isRoot && (
        <>
          {node.missingParent && (
            <div className="flex items-center gap-1.5 text-xs text-destructive/70 py-1 px-2 border-y border-destructive/20 bg-destructive/5">
              <AlertTriangle className="h-3 w-3" />
              <span>missing parent note</span>
            </div>
          )}
          {renderEvent ? (
            renderEvent(node.event, node)
          ) : (
            <ThreadComment event={node.event} />
          )}
        </>
      )}

      {/* Render children with nesting */}
      {visibleChildren.length > 0 && (
        <ThreadChildren
          nodes={visibleChildren}
          renderEvent={renderEvent}
          filterChildren={filterChildren}
          isMissingParentContext={node.missingParent}
          depth={depth + 1}
        />
      )}
    </div>
  );

  // Provide context at the top level; nested nodes inherit it automatically.
  if (threadContext) {
    return (
      <ThreadCtx.Provider value={threadContext}>{inner}</ThreadCtx.Provider>
    );
  }
  return inner;
}

// ---------------------------------------------------------------------------
// ThreadComment — borderless comment for use inside the thread tree
// ---------------------------------------------------------------------------

/**
 * Lightweight comment renderer without a Card wrapper. The thread's left
 * border line provides the visual container; each comment is separated by
 * a subtle top border.
 */
function ThreadComment({ event }: { event: NostrEvent }) {
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  const anchorId = event.id.slice(0, 15);
  const elRef = useRef<HTMLDivElement>(null);
  const isTargeted = window.location.hash === `#${anchorId}`;
  const [highlight, setHighlight] = useState<"strong" | "subtle" | "none">(
    isTargeted ? "strong" : "none",
  );
  const [replying, setReplying] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const ctx = useContext(ThreadCtx);
  const canReply = !!ctx;
  const activeAccount = useActiveAccount();
  const isOwn = !!activeAccount && activeAccount.pubkey === event.pubkey;

  const confirmDelete = useCallback(async () => {
    if (deleting || !ctx) return;
    setDeleting(true);
    try {
      await runner.run(
        DeleteEvent,
        [event],
        ctx.repoRelays,
        ctx.repoCoords,
        deleteReason.trim() || undefined,
      );
    } catch (err) {
      console.error("[ThreadComment] failed to delete comment:", err);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteReason("");
    }
  }, [deleting, ctx, event, deleteReason]);

  useEffect(() => {
    if (!isTargeted || !elRef.current) return;

    const el = elRef.current;

    // Once the user intentionally scrolls, stop chasing them back to the
    // target element.
    let userScrolled = false;
    const onUserScroll = () => {
      userScrolled = true;
    };
    window.addEventListener("wheel", onUserScroll, {
      passive: true,
      once: true,
    });
    window.addEventListener("touchmove", onUserScroll, {
      passive: true,
      once: true,
    });
    window.addEventListener("keydown", onUserScroll, {
      passive: true,
      once: true,
    });

    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    let dimTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            clearTimeout(dimTimer);
            dimTimer = setTimeout(() => {
              setHighlight("subtle");
              observer.disconnect();
            }, 3000);
          } else if (dimTimer !== undefined && !userScrolled) {
            // Pushed off-screen by new content before timer fired — scroll back
            clearTimeout(dimTimer);
            dimTimer = undefined;
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            // User scrolled away — stop tracking
            clearTimeout(dimTimer);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(dimTimer);
      observer.disconnect();
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.removeEventListener("keydown", onUserScroll);
    };
  }, [isTargeted]);

  return (
    <div
      id={anchorId}
      ref={elRef}
      className={`min-w-0 overflow-hidden border-t border-border/40 p-3 scroll-mt-20 transition-colors duration-700 ${
        highlight === "strong"
          ? "bg-violet-500/10"
          : highlight === "subtle"
            ? "bg-violet-500/5"
            : ""
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="md"
            nameClassName="text-sm"
          />
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {timeAgo}
            </span>
            <OutboxStatusBadge event={event} />
          </span>
        </div>
        <div className="flex items-center gap-1">
          {canReply && (
            <button
              type="button"
              onClick={() => setReplying((r) => !r)}
              className="flex items-center text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1.5 py-0.5 rounded"
              aria-label="Reply to comment"
            >
              <Reply className="h-3.5 w-3.5" />
            </button>
          )}
          {isOwn && ctx && (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="flex items-center text-xs text-muted-foreground/60 hover:text-destructive transition-colors px-1.5 py-0.5 rounded"
              aria-label="Delete comment"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <EventCardActions event={event} />
        </div>
      </div>
      {/* Body: on small screens equal padding; on sm+ align under username text.
          UserLink uses w-8 avatar + gap-1.5 = 38px before the name text. */}
      <div className="sm:ml-[38px]">
        <CommentContent content={event.content} />
        {ctx && (
          <ReactionsBar
            event={event}
            repoRelays={ctx.repoRelays}
            repoCoords={ctx.repoCoords}
          />
        )}
      </div>

      {/* Inline reply composer */}
      {replying && ctx && (
        <div className="mt-3 sm:ml-[38px]">
          <ReplyBox
            rootEvent={ctx.rootEvent}
            parentEvent={event}
            repoRelays={ctx.repoRelays}
            onSubmitted={() => setReplying(false)}
          />
        </div>
      )}

      {/* Delete comment dialog */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(v) => !v && setDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a deletion request (NIP-09). Not all relays honour
              deletion requests — the comment may remain visible on some
              clients.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="delete-comment-reason" className="text-sm">
              Reason{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="delete-comment-reason"
              placeholder="Why are you deleting this comment?"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteOpen(false);
                setDeleteReason("");
              }}
              disabled={deleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Sending…" : "Send deletion request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible children wrapper
// ---------------------------------------------------------------------------

function ThreadChildren({
  nodes,
  renderEvent,
  filterChildren,
  isMissingParentContext,
  depth,
}: {
  nodes: ThreadTreeNode[];
  renderEvent?: ThreadTreeProps["renderEvent"];
  filterChildren?: ThreadTreeProps["filterChildren"];
  isMissingParentContext?: boolean;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const totalDescendants = nodes.reduce(
    (sum, n) => sum + 1 + countDescendants(n),
    0,
  );

  // Fade the line as depth increases: start at 0.5 opacity, floor at 0.15.
  const lineOpacity = isMissingParentContext
    ? 0.4
    : Math.max(0.15, 0.5 - (depth - 1) * 0.1);

  return (
    <div
      className="min-w-0 border-l pl-1"
      style={{ borderLeftColor: `rgb(59 130 246 / ${lineOpacity})` }}
    >
      {/* Collapse / expand toggle */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full text-left flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 hover:bg-muted px-2 py-1.5 transition-colors cursor-pointer"
          aria-label="Expand replies"
        >
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          <span>
            show {totalDescendants} hidden{" "}
            {totalDescendants === 1 ? "reply" : "replies"}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex items-center text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors py-0.5"
          aria-label="Collapse replies"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Children */}
      {!collapsed &&
        nodes.map((child) => (
          <ThreadTree
            key={child.event.id}
            node={child}
            renderEvent={renderEvent}
            filterChildren={filterChildren}
            depth={depth}
          />
        ))}
    </div>
  );
}
