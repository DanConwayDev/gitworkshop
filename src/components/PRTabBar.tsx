/**
 * PRTabBar — link-based tab navigation for PR/patch detail views.
 *
 * Uses <Link> instead of Radix TabsTrigger so it works on any page that
 * lives under the PR route (conversation, files, commits, and commit detail).
 * The active tab is derived from the current URL pathname.
 */

import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircle, FileDiff, GitCommitHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResolvedPR } from "@/lib/nip34";
import type { Patch } from "@/casts/Patch";

export interface PRTabBarProps {
  prBasePath: string;
  pr: ResolvedPR | undefined;
  /** Non-cover-letter patches in the latest revision (patch-type PRs only). */
  patchChain?: Patch[];
  /** Number of files changed (undefined while computing). */
  fileCount?: number;
  /** Number of commits in the PR (PR-type only). */
  commitCount?: number;
}

export function PRTabBar({
  prBasePath,
  pr,
  patchChain,
  fileCount,
  commitCount,
}: PRTabBarProps) {
  const location = useLocation();

  const activeTab = useMemo(() => {
    const p = location.pathname;
    // A commit detail page lives under /commit/ — treat as "commits" tab active
    if (p.includes("/commit/")) return "commits";
    if (p.endsWith("/commits")) return "commits";
    if (p.endsWith("/files")) return "files";
    return "conversation";
  }, [location.pathname]);

  const showFiles =
    pr?.itemType === "pr" ||
    (pr?.itemType === "patch" && patchChain && patchChain.length > 0);

  const showCommits =
    (pr?.itemType === "pr" && !!pr.tip.commitId) ||
    (patchChain && patchChain.length > 0);

  const tabClass = (tab: string) =>
    cn(
      "inline-flex items-center gap-1.5 text-sm rounded-none px-3 pb-2 pt-1 h-auto border-b-2 transition-colors",
      activeTab === tab
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex gap-0">
      {/* Conversation */}
      <Link to={prBasePath} className={tabClass("conversation")}>
        <MessageCircle className="h-3.5 w-3.5" />
        Conversation
        {pr && (
          <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
            {pr.commentCount}
          </span>
        )}
      </Link>

      {/* Files Changed */}
      {showFiles && (
        <Link to={`${prBasePath}/files`} className={tabClass("files")}>
          <FileDiff className="h-3.5 w-3.5" />
          Files Changed
          {fileCount !== undefined && fileCount > 0 && (
            <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
              {fileCount}
            </span>
          )}
        </Link>
      )}

      {/* Commits */}
      {showCommits && (
        <Link to={`${prBasePath}/commits`} className={tabClass("commits")}>
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          Commits
          {pr?.itemType === "pr" &&
            commitCount !== undefined &&
            commitCount > 0 && (
              <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
                {commitCount}
              </span>
            )}
          {pr?.itemType === "patch" && patchChain && patchChain.length > 0 && (
            <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
              {patchChain.length}
            </span>
          )}
        </Link>
      )}
    </div>
  );
}
