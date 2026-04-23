import { useMemo } from "react";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useGitPool } from "@/hooks/useGitPool";
import { CommitDetailView } from "@/components/CommitDetailView";
import { isNonHttpUrl } from "@/lib/git-grasp-pool";
import { IncompatibleProtocolError } from "@/components/IncompatibleProtocolError";

export default function RepoCommitPage() {
  const { cloneUrls, commitId, resolved } = useRepoContext();
  const repo = resolved?.repo;

  useSeoMeta({
    title: repo
      ? `${commitId?.slice(0, 8) ?? "Commit"} - ${repo.name} - ngit`
      : "Commit - ngit",
    description: `View commit details${repo ? ` for ${repo.name}` : ""}`,
  });

  const basePath = useMemo(() => {
    const pathname = window.location.pathname;
    const idx = pathname.indexOf("/commit/");
    return idx !== -1 ? pathname.slice(0, idx) : pathname;
  }, []);

  const { pool } = useGitPool(cloneUrls);

  if (!commitId) {
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

  if (cloneUrls.length > 0 && cloneUrls.every(isNonHttpUrl)) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <IncompatibleProtocolError cloneUrls={cloneUrls} context="commit" />
      </div>
    );
  }

  if (!pool) return null;

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <CommitDetailView
        commitId={commitId}
        pool={pool}
        basePath={basePath}
        backTo={`${basePath}/commits`}
      />
    </div>
  );
}
