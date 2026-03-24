import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Returns the "directory" portion of a /tree/ path, i.e. everything up to
 * (but not including) the last path segment after /tree/ref.
 *
 * Examples:
 *   /npub/repo/tree/main            → "/npub/repo/tree/main"
 *   /npub/repo/tree/main/src        → "/npub/repo/tree/main"  (src could be dir or file)
 *   /npub/repo/tree/main/src/foo.ts → "/npub/repo/tree/main/src"
 *
 * For non-tree paths the full pathname is returned so they always trigger a
 * scroll-to-top.
 */
function treeParentDir(pathname: string): string {
  const treeIdx = pathname.indexOf("/tree/");
  if (treeIdx === -1) return pathname;

  // Everything after /tree/ — e.g. "main/src/foo.ts"
  const afterTree = pathname.slice(treeIdx + "/tree/".length);
  const segments = afterTree.split("/").filter(Boolean);

  // At root (just the ref, no sub-path): parent is the full pathname
  if (segments.length <= 1) return pathname;

  // Drop the last segment — what remains is the parent directory
  const parentSegments = segments.slice(0, -1);
  return pathname.slice(0, treeIdx) + "/tree/" + parentSegments.join("/");
}

export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const prevPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    if (prev === null) {
      // Initial mount — scroll to top unless there's a hash fragment target
      if (!hash) window.scrollTo(0, 0);
      return;
    }

    if (prev === pathname) return;

    // If the new URL has a hash fragment, let the browser / CommentCard handle
    // scrolling to the anchor — don't reset to the top.
    if (hash) return;

    const prevParent = treeParentDir(prev);
    const nextParent = treeParentDir(pathname);

    // Same parent directory → user clicked a sibling file; preserve scroll
    if (prevParent === nextParent) return;

    // Directory changed (or non-tree navigation) → scroll to top
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
}
