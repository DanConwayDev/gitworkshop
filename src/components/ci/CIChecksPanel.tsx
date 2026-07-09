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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
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

const LOG_TAIL_PREFIX_RE = /^\[log-tail omitted=(\d+)\]\n/;
const LOG_TOP_THRESHOLD_PX = 4;

function parseLogTail(content: string): {
  log: string;
  omittedBytes: number | undefined;
} {
  const match = LOG_TAIL_PREFIX_RE.exec(content);
  if (!match) return { log: content, omittedBytes: undefined };

  const omittedBytes = Number.parseInt(match[1], 10);
  return {
    log: content.slice(match[0].length),
    omittedBytes: Number.isFinite(omittedBytes) ? omittedBytes : undefined,
  };
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
                  (run.status === "failure" ||
                    run.status === "timed_out" ||
                    run.status === "startup_failure")
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

export function CIRunRow({
  run,
  defaultOpen = false,
  triggerContext,
}: {
  run: CIWorkflowRun;
  defaultOpen?: boolean;
  /**
   * Optional trigger context element (branch name, PR link) shown on the
   * right of the row — used by the repo Actions tab.
   */
  triggerContext?: ReactNode;
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
            {triggerContext}
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
            {run.inProgressJobs.map((jobId) => (
              <div
                key={`progress-${jobId}`}
                className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground"
              >
                <CIStatusIcon status="pending" className="h-3.5 w-3.5" />
                <span className="truncate font-mono">{jobId}</span>
                <span className="ml-auto shrink-0">in progress</span>
              </div>
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
        <span className="truncate font-mono">{result.name ?? job.jobId}</span>
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
        <CILogViewer log={result.log} logUrl={result.logUrl} />
      )}
    </div>
  );
}

function CILogViewer({
  log,
  logUrl,
}: {
  log: string;
  logUrl: string | undefined;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const logContentRef = useRef<HTMLPreElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const didInitialPositionRef = useRef(false);
  const restoreDistanceFromBottomRef = useRef<number | null>(null);

  const parsed = useMemo(() => parseLogTail(log), [log]);
  const [fullLog, setFullLog] = useState<string | undefined>(undefined);
  const [isLoadingFullLog, setIsLoadingFullLog] = useState(false);
  const [fullLogError, setFullLogError] = useState<string | undefined>(
    undefined,
  );

  const visibleLog = fullLog ?? parsed.log;
  const isTailOnly = parsed.omittedBytes !== undefined && fullLog === undefined;

  useLayoutEffect(() => {
    didInitialPositionRef.current = false;
    restoreDistanceFromBottomRef.current = null;
  }, [log, logUrl]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    restoreDistanceFromBottomRef.current = null;
    setFullLog(undefined);
    setIsLoadingFullLog(false);
    setFullLogError(undefined);

    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [log, logUrl]);

  const loadFullLog = useCallback(async () => {
    if (!isTailOnly || isLoadingFullLog || !logUrl) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoadingFullLog(true);
    setFullLogError(undefined);

    try {
      const response = await fetch(logUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      const node = containerRef.current;
      const noticeHeight = noticeRef.current?.offsetHeight ?? 0;
      const logHeight = logContentRef.current?.scrollHeight ?? 0;
      restoreDistanceFromBottomRef.current = node
        ? Math.max(
            0,
            logHeight -
              Math.max(0, node.scrollTop - noticeHeight) -
              node.clientHeight,
          )
        : null;
      setFullLog(text);
    } catch (error) {
      if (controller.signal.aborted) return;
      const reason = error instanceof Error ? error.message : "Unknown error";
      setFullLogError(
        `Full log is no longer available. Showing the saved tail. (${reason})`,
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingFullLog(false);
        abortRef.current = null;
      }
    }
  }, [isLoadingFullLog, isTailOnly, logUrl]);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node || node.scrollTop > LOG_TOP_THRESHOLD_PX || fullLogError) return;
    void loadFullLog();
  }, [fullLogError, loadFullLog]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    if (!didInitialPositionRef.current) {
      node.scrollTop = node.scrollHeight;
      didInitialPositionRef.current = true;
      return;
    }

    const distanceFromBottom = restoreDistanceFromBottomRef.current;
    if (distanceFromBottom === null) return;

    const logHeight = logContentRef.current?.scrollHeight ?? node.scrollHeight;
    node.scrollTop = Math.max(
      0,
      logHeight - node.clientHeight - distanceFromBottom,
    );
    restoreDistanceFromBottomRef.current = null;
  }, [visibleLog]);

  useEffect(() => {
    if (!isTailOnly || fullLogError) return;
    void loadFullLog();
  }, [fullLogError, isTailOnly, loadFullLog]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={cn(
        "max-h-64 overflow-auto border-t border-border/60 bg-muted/50",
        "font-mono text-[11px] leading-relaxed",
      )}
    >
      {isTailOnly && (
        <div
          ref={noticeRef}
          className="border-b border-border/60 bg-muted/95 px-3 py-2 font-sans text-xs text-muted-foreground"
        >
          {isLoadingFullLog ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading full log…
            </span>
          ) : fullLogError ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex min-w-0 items-center gap-2 text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{fullLogError}</span>
              </span>
              {logUrl && (
                <button
                  type="button"
                  onClick={() => void loadFullLog()}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Retry
                </button>
              )}
            </span>
          ) : logUrl ? (
            <span>
              Earlier log output omitted ({parsed.omittedBytes} bytes). Loading
              the full log…
            </span>
          ) : (
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Earlier log output omitted ({parsed.omittedBytes} bytes), but no
              full log link was included.
            </span>
          )}
        </div>
      )}
      <pre
        ref={logContentRef}
        className="m-0 whitespace-pre-wrap break-words p-3"
      >
        {visibleLog}
      </pre>
    </div>
  );
}
