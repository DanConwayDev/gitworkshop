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
import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronUp, ChevronDown, AlertTriangle, Calendar } from "lucide-react";
import type { NostrEvent } from "nostr-tools";
import type { ThreadTreeNode } from "@/lib/threadTree";
import { countDescendants } from "@/lib/threadTree";
import { UserLink } from "@/components/UserAvatar";
import { EventCardActions } from "@/components/EventCardActions";
import { CommentContent } from "@/components/CommentContent";

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
}: ThreadTreeProps) {
  const visibleChildren = filterChildren
    ? node.children.filter(filterChildren)
    : node.children;

  return (
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
      className={`border-t border-border/40 py-3 px-2 scroll-mt-20 transition-colors duration-700 ${
        highlight === "strong"
          ? "bg-violet-500/10"
          : highlight === "subtle"
            ? "bg-violet-500/5"
            : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="md"
            nameClassName="text-sm"
          />
          <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {timeAgo}
          </span>
        </div>
        <EventCardActions event={event} />
      </div>
      <CommentContent content={event.content} />
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
      className="border-l-2 ml-1 pl-1"
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
