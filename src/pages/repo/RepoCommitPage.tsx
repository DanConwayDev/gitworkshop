import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useGitPool } from "@/hooks/useGitPool";
import { CommitDetailView } from "@/components/CommitDetailView";
import { useCIForCommit } from "@/hooks/useCI";
import { CIChecksPanel } from "@/components/ci/CIChecksPanel";
import { isNonHttpUrl } from "@/lib/git-grasp-pool";
import { IncompatibleProtocolError } from "@/components/IncompatibleProtocolError";
import { useActiveAccount } from "applesauce-react/hooks";

export default function RepoCommitPage() {
  const { cloneUrls, commitId, resolved, pubkey, repoId, basePath } =
    useRepoContext();
  const repo = resolved?.repo;
  const account = useActiveAccount();
  const isMaintainer =
    !!account && !!repo?.maintainerSet.includes(account.pubkey);
  const repoOwnerProfile = useProfile(pubkey);

  useSeoMeta({
    title: repo
      ? `${commitId?.slice(0, 8) ?? "Commit"} - ${repo.name} - ngit`
      : "Commit - ngit",
    description: `View commit details${repo ? ` for ${repo.name}` : ""}`,
    ogImage: repoOwnerProfile?.picture ?? "/og-image.svg",
    ogImageAlt: repo?.name,
    twitterCard: repoOwnerProfile?.picture ? "summary" : "summary_large_image",
  });

  const { pool } = useGitPool(cloneUrls);

  // CI checks (ngit-ci kinds 9841/9842) for this commit — shown between the
  // commit header and the diff.
  const ci = useCIForCommit(commitId, resolved?.repoRelayGroup);

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
        <IncompatibleProtocolError
          cloneUrls={cloneUrls}
          context="commit"
          pubkey={pubkey}
          repoId={repoId}
        />
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
        headerExtra={
          ci && ci.runs.length > 0 ? (
            <CIChecksPanel
              checks={{
                runs: ci.runs,
                currentRuns: ci.runs,
                olderRuns: [],
                status: ci.status,
              }}
              canRetry={isMaintainer}
            />
          ) : undefined
        }
      />
    </div>
  );
}
