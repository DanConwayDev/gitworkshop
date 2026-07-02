/**
 * CIChecksPanel — GitHub-style checks box for a PR / patch detail page.
 *
 * Displays ngit-ci workflow runs (kinds 9841/9842) grouped by
 * (runner, commit, workflow): a summary header, one expandable row per
 * workflow run for the current tip commit, and a collapsed section for runs
 * against superseded commits.
 *
 * No trust filtering is applied yet — the signing runner identity is shown
 * on every row so users can judge results for themselves.
 */

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { UserLink } from "@/components/UserAvatar";
import { CIStatusIcon } from "./CIStatusIcon";
import { cn } from "@/lib/utils";
import {
  ciStatusLabel,
  formatCIDuration,
  summarizeRuns,
  type CIJobResult,
  type CIWorkflowRun,
} from "@/lib/ci";
import type { PRCIChecks } from "@/hooks/useCI";

interface CIChecksPanelProps {
  checks: PRCIChecks;
  className?: string;
}

export function CIChecksPanel({ checks, className }: CIChecksPanelProps) {
  const { currentRuns, olderRuns } = checks;
  if (checks.runs.length === 0) return null;

  return (
    <Card className={className}>
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          {checks.status && (
            <CIStatusIcon status={checks.status} className="h-5 w-5" />
          )}
          <span className="text-sm font-medium">Checks</span>
          {currentRuns.length > 0 && (
            <span className="text-xs text-muted-foreground truncate">
              {summarizeRuns(currentRuns)}
            </span>
          )}
        </div>

        {/* Runs for the current tip commit */}
        {currentRuns.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            No checks for the latest commit yet.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {currentRuns.map((run) => (
              <CIRunRow
                key={run.key}
                run={run}
                defaultOpen={
                  currentRuns.length === 1 &&
                  (run.status === "failure" || run.status === "error")
                }
              />
            ))}
          </ul>
        )}

        {/* Runs for superseded commits — collapsed by default */}
        {olderRuns.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 border-t border-border/60 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-accent/40 transition-colors">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
              Checks for previous commits ({olderRuns.length})
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="divide-y divide-border/60 border-t border-border/60 opacity-80">
                {olderRuns.map((run) => (
                  <CIRunRow key={run.key} run={run} />
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function CIRunRow({
  run,
  defaultOpen = false,
}: {
  run: CIWorkflowRun;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const relativeTime = formatDistanceToNow(new Date(run.createdAt * 1000), {
    addSuffix: true,
  });

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2 px-4 py-2.5">
          {/* Trigger area — UserLink stays outside to avoid nested anchors */}
          <CollapsibleTrigger className="group flex flex-1 min-w-0 items-center gap-2 text-left">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            <CIStatusIcon status={run.status} />
            <span className="truncate font-mono text-xs">
              {run.workflowPath ?? "(workflow)"}
            </span>
            <span className="hidden sm:inline shrink-0 text-xs text-muted-foreground">
              {run.status === "pending"
                ? `started ${relativeTime}`
                : `${ciStatusLabel(run.status).toLowerCase()} ${relativeTime}`}
            </span>
          </CollapsibleTrigger>

          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {run.commitId && (
              <code className="hidden sm:inline font-mono text-[10px]">
                {run.commitId.slice(0, 7)}
              </code>
            )}
            <UserLink
              pubkey={run.pubkey}
              avatarSize="xs"
              nameClassName="text-xs font-normal text-muted-foreground max-w-24 truncate"
            />
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-2 pb-3 pl-10 pr-4">
            {(run.runner || run.platform || run.trigger) && (
              <div className="text-[11px] text-muted-foreground">
                {[run.runner, run.platform, run.trigger]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
            {run.pendingRun && (
              <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <CIStatusIcon status="pending" className="h-3.5 w-3.5" />
                Workflow started{" "}
                {formatDistanceToNow(
                  new Date(run.pendingRun.event.created_at * 1000),
                  { addSuffix: true },
                )}
              </div>
            )}
            {run.jobs.map((job) => (
              <CIJobRow key={job.jobId} job={job} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function CIJobRow({ job }: { job: CIJobResult }) {
  const [showLog, setShowLog] = useState(false);
  const { result } = job;
  const hasLog = result.log.trim().length > 0;
  const duration = formatCIDuration(result.duration);

  return (
    <div className="rounded-md border border-border/60">
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <CIStatusIcon status={job.status} className="h-3.5 w-3.5" />
        <span className="truncate font-mono">{job.jobId}</span>
        {result.exitCode !== undefined && result.exitCode !== 0 && (
          <span className="shrink-0 text-red-500">exit {result.exitCode}</span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {duration}
        </span>
        {hasLog && (
          <button
            type="button"
            onClick={() => setShowLog((s) => !s)}
            className="shrink-0 text-muted-foreground hover:text-foreground hover:underline transition-colors"
          >
            {showLog ? "Hide log" : "Show log"}
          </button>
        )}
        {result.logUrl && (
          <a
            href={result.logUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open full log"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {hasLog && showLog && (
        <pre
          className={cn(
            "max-h-64 overflow-auto whitespace-pre-wrap break-words",
            "border-t border-border/60 bg-muted/50 p-3",
            "font-mono text-[11px] leading-relaxed",
          )}
        >
          {result.log}
        </pre>
      )}
    </div>
  );
}
