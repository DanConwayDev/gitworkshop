/**
 * RepoActionsPage — repo-wide CI workflow runs (ngit-ci kinds 9841/9842).
 *
 * Lists every workflow run published for the repository, most recent first,
 * with optional workflow / trigger filters. Runs are fetched repo-wide by
 * #a via useRepoCI — multi-maintainer repos are announced under one
 * coordinate per maintainer, so the full coordinate set is queried.
 *
 * Rows reuse CIRunRow from the PR checks panel; each row shows its trigger
 * context (branch or tag for pushes, a PR link for PR-triggered runs).
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { GitPullRequest, X } from "lucide-react";
import { useRepoContext } from "./RepoContext";
import { useRepoCI } from "@/hooks/useCI";
import { CIRunRow, CITriggerRefBadge } from "@/components/ci/CIChecksPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { eventIdToNevent } from "@/lib/routeUtils";
import type { CIWorkflowRun } from "@/lib/ci";

const ALL = "__all__";

export default function RepoActionsPage() {
  const { resolved, basePath } = useRepoContext();
  const repo = resolved?.repo;

  const runs = useRepoCI(repo?.allCoordinates, resolved?.repoRelayGroup);

  const [workflowFilter, setWorkflowFilter] = useState<string>(ALL);
  const [triggerFilter, setTriggerFilter] = useState<string>(ALL);

  // Distinct filter options derived from the loaded runs
  const workflows = useMemo(() => {
    const set = new Set<string>();
    for (const run of runs ?? []) {
      if (run.workflowPath) set.add(run.workflowPath);
    }
    return [...set].sort();
  }, [runs]);

  const triggers = useMemo(() => {
    const set = new Set<string>();
    for (const run of runs ?? []) {
      if (run.trigger) set.add(run.trigger);
    }
    return [...set].sort();
  }, [runs]);

  const hasActiveFilters = workflowFilter !== ALL || triggerFilter !== ALL;

  const filteredRuns = useMemo(() => {
    if (!runs) return undefined;
    return runs.filter(
      (run) =>
        (workflowFilter === ALL || run.workflowPath === workflowFilter) &&
        (triggerFilter === ALL || run.trigger === triggerFilter),
    );
  }, [runs, workflowFilter, triggerFilter]);

  useSeoMeta({
    title: repo ? `Actions - ${repo.name} - ngit` : "Actions - ngit",
    description: "CI workflow runs for this repository",
  });

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      {/* Header + filters */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold shrink-0">Actions</h2>

        <div className="flex gap-2 flex-wrap items-center md:ml-auto">
          {workflows.length > 1 && (
            <Select value={workflowFilter} onValueChange={setWorkflowFilter}>
              <SelectTrigger className="w-[220px] h-9 text-sm">
                <SelectValue placeholder="Workflow" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Workflows</SelectItem>
                {workflows.map((w) => (
                  <SelectItem key={w} value={w}>
                    <span className="font-mono text-xs">{w}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {triggers.length > 1 && (
            <Select value={triggerFilter} onValueChange={setTriggerFilter}>
              <SelectTrigger className="w-[150px] h-9 text-sm">
                <SelectValue placeholder="Trigger" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Triggers</SelectItem>
                {triggers.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setWorkflowFilter(ALL);
                setTriggerFilter(ALL);
              }}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Run list */}
      {!filteredRuns ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <ul className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <ActionRowSkeleton key={i} />
            ))}
          </ul>
        </div>
      ) : filteredRuns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <p className="text-muted-foreground max-w-sm mx-auto">
              {hasActiveFilters
                ? "No workflow runs match your filters."
                : "No workflow runs found for this repository yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <ul className="divide-y divide-border">
            {filteredRuns.map((run) => (
              <CIRunRow
                key={run.key}
                run={run}
                triggerContext={
                  <RunTriggerContext
                    run={run}
                    basePath={basePath}
                    repoRelays={repo?.relays ?? []}
                  />
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Trigger context for a run row — a PR link for PR-triggered runs, or the
 * branch or tag name (linked to its commit history) for push-triggered runs.
 */
function RunTriggerContext({
  run,
  basePath,
  repoRelays,
}: {
  run: CIWorkflowRun;
  basePath: string;
  repoRelays: string[];
}) {
  if (run.prRootId) {
    const nevent = eventIdToNevent(run.prRootId, repoRelays.slice(0, 1));
    return (
      <Link
        to={`${basePath}/prs/${nevent}`}
        className="hidden sm:inline-flex items-center gap-1 hover:text-foreground hover:underline transition-colors"
      >
        <GitPullRequest className="h-3 w-3" />
        PR
      </Link>
    );
  }

  const ref = run.branchRef;
  if (!ref) return null;

  const isBranch = ref.startsWith("refs/heads/");
  const isTag = ref.startsWith("refs/tags/");
  if (!isBranch && !isTag) return null;

  const refName = isBranch
    ? ref.slice("refs/heads/".length)
    : ref.slice("refs/tags/".length);
  if (refName) {
    return (
      <Link
        to={`${basePath}/commits/${refName}`}
        className="hidden sm:inline-flex items-center gap-1 max-w-32 hover:text-foreground hover:underline transition-colors"
      >
        <CITriggerRefBadge ref={ref} />
      </Link>
    );
  }

  return null;
}

function ActionRowSkeleton() {
  return (
    <li className="flex items-center gap-2 px-4 py-2.5">
      <Skeleton className="h-4 w-4 rounded-full" />
      <Skeleton className="h-4 w-64" />
      <div className="ml-auto flex items-center gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-5 w-5 rounded-full" />
      </div>
    </li>
  );
}
