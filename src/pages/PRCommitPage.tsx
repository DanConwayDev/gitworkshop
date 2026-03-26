/**
 * PRCommitPage — commit detail view scoped to a pull request.
 *
 * Rendered at: prs/<prId>/commit/<commitId>
 *
 * The "All commits" back link returns to the PR's commits tab
 * (prs/<prId>/commits) rather than the repo-wide commits page.
 */

import { useMemo } from "react";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useGitPool } from "@/hooks/useGitPool";
import { CommitDetailView } from "@/components/CommitDetailView";
import { useEventStore } from "@/hooks/useEventStore";
import { PR_KIND } from "@/lib/nip34";

export default function PRCommitPage() {
  const { cloneUrls, prCommitId, prBasePath, prId } = useRepoContext();
  const store = useEventStore();

  const { pool } = useGitPool(cloneUrls);

  // Extract PR clone URLs from the store (already loaded by PRPage) to use as
  // per-operation fallback sources when fetching this commit's git data.
  const prCloneUrls = useMemo(() => {
    if (!prId) return [];
    const prEvent = store.getByFilters([{ kinds: [PR_KIND], ids: [prId] }])[0];
    if (!prEvent) return [];
    return prEvent.tags
      .filter(([t]) => t === "clone")
      .flatMap(([, ...urls]) => urls.filter(Boolean));
  }, [prId, store]);

  if (!prCommitId) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>No commit ID specified.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!pool) return null;

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <CommitDetailView
        commitId={prCommitId}
        pool={pool}
        basePath={prBasePath ?? ""}
        backTo={prBasePath ? `${prBasePath}/commits` : ".."}
        fallbackUrls={prCloneUrls}
      />
    </div>
  );
}
