/**
 * MergePanel — merge/apply button and status panel for PRs on Grasp repos.
 *
 * Shown at the bottom of the conversation tab, above the reply box. Eagerly
 * checks whether the patch chain / PR branch can be merged or applied and
 * shows one of:
 *   - "Ready to merge" with a green Merge button (merge strategy succeeded)
 *   - "Apply to Tip" with an amber Apply button + warning (only apply-to-tip works)
 *   - "Conflicts detected" with file-level details
 *   - "Error" with a human-readable message
 *
 * The heavy lifting lives in `@/lib/git-grasp-pool`:
 *   - `performMerge` / `performPRMerge` / `performApplyToTip` — the shared
 *     purgatory → push → status → broadcast orchestration (`merge.ts`).
 *   - `GitGraspPool.pushRefUpdate` — the multi-server Grasp push that
 *     tolerates lagging mirrors (`grasp-push.ts`).
 *   - `useDetectedMergeCommit` — best-effort "already merged?" history scan
 *     (`detect-merged.ts`).
 *
 * This component only wires those up with the app's account, outbox, relay
 * pool, and EventStore, and renders the states.
 */

import { useState, useCallback, useMemo } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import {
  GitMerge,
  GitBranch,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Info,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/useToast";
import { useMyProfile, useProfile } from "@/hooks/useProfile";
import {
  usePatchMergeability,
  type MergeabilityStatus,
} from "@/hooks/usePatchMergeability";
import {
  usePRMergeability,
  type PRMergeabilityStatus,
} from "@/hooks/usePRMergeability";
import { useDetectedMergeCommit } from "@/hooks/useDetectedMergeCommit";
import {
  performMerge,
  performPRMerge,
  performApplyToTip,
  signMergedStatus,
  buildPRNevent,
  createCommitPersonNow,
  summarizePushDelivery,
  formatCloneUrlHost,
  getGitRemoteHostname,
  type GitGraspPool,
  type GraspMergeTransports,
  type IssueAutoResolveContext,
  type IssueCandidate,
  type PushDeliverySummary,
} from "@/lib/git-grasp-pool";
import { pool as relayPool, eventStore } from "@/services/nostr";
import { outboxStore } from "@/services/outbox";

import type { CommitPerson } from "@/lib/git-objects";
import type { PackableObject } from "@/lib/git-packfile";
import type { Patch } from "@/casts/Patch";
import {
  getStateRefs,
  type ResolvedRepo,
  type ResolvedPR,
  type ResolvedIssueLite,
} from "@/lib/nip34";

const PR_BRANCH_OBJECT_FETCH_TIMEOUT_MS = 90_000;
const ISSUE_STATE_DELTA_FETCH_TIMEOUT_MS = 30_000;
const ISSUE_STATE_DELTA_MAX_DEPTH = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MergePanelProps {
  /** The resolved PR (patch-type or pr-type) */
  pr: ResolvedPR;
  /** The resolved repository */
  repo: ResolvedRepo;
  /**
   * The patch chain (cover letters excluded). Required for patch-type items.
   * Omit (or pass undefined) for PR-type items.
   */
  patchChain?: Patch[];
  /** GitGraspPool for fetching base tree / file content */
  gitPool: GitGraspPool | null;
  /** All effective clone URLs */
  effectiveCloneUrls: string[];
  /** Behind count (how many commits the default branch moved since the patch base) */
  behindCount: number | undefined;
  /** The default branch name (e.g. "main") */
  defaultBranchName: string;
  /** The current HEAD commit of the default branch */
  defaultBranchHead: string | undefined;
  /** Current kind:30618 repository state, used to preserve existing branches/tags. */
  currentStateEvent?: NostrEvent | null;
  /**
   * Guessed base commit ID from the timestamp heuristic, used when the first
   * patch has no `parent-commit` tag. Passed through to usePatchMergeability.
   * Only relevant for patch-type items.
   */
  guessedBaseCommitId?: string;
  /**
   * NIP-19 nevent identifier for the PR event.
   * Required for PR-type items (used in the merge commit message).
   */
  prNevent?: string;
  /**
   * The repo's known issues (from RepoContext). Used to auto-resolve issues
   * referenced by `closes/fixes/resolves/implements` keywords in the commit
   * messages landing with the merge — including the merge commit itself —
   * matching ngit's push-time behaviour.
   */
  issues?: ResolvedIssueLite[];
  /**
   * Called after at least one Grasp server accepted the git push. Lets the
   * parent keep this panel mounted after the merged status event changes the PR
   * status to resolved.
   */
  onSuccessfulPush?: () => void;
}

type MergeStep =
  | "idle"
  | "building"
  | "publishing-state"
  | "pushing"
  | "publishing-status"
  | "broadcasting-state"
  | "done"
  | "failed";

type MergePanelStatus =
  | MergeabilityStatus
  | PRMergeabilityStatus
  | "detected-merged";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a relay URL's hostname matches one of the Grasp server domains.
 */
function isGraspRelay(relayUrl: string, graspDomains: string[]): boolean {
  if (!graspDomains.length) return false;
  try {
    const hostname = new URL(relayUrl).hostname;
    return graspDomains.includes(hostname);
  } catch {
    return false;
  }
}

function formatGitServerName(cloneUrls: string[]): string {
  const hostname = cloneUrls
    .map(getGitRemoteHostname)
    .find((host): host is string => !!host);

  if (!hostname) return "a non-GRASP git server";

  const lowerHost = hostname.toLowerCase();
  if (lowerHost.includes("gitlab")) return "GitLab";
  if (lowerHost.includes("github")) return "GitHub";
  if (lowerHost.includes("bitbucket")) return "Bitbucket";
  if (lowerHost.includes("codeberg")) return "Codeberg";
  if (lowerHost.includes("sr.ht") || lowerHost.includes("sourcehut")) {
    return "SourceHut";
  }

  return hostname;
}

/** Toast suffix for issues auto-resolved from commit-message keywords. */
function formatResolvedIssuesSuffix(count: number): string {
  if (count === 0) return "";
  return ` Auto-resolved ${count} issue${count !== 1 ? "s" : ""} from commit keywords.`;
}

/**
 * Publish an event to Grasp relays only and await at least one acceptance.
 */
async function publishToGraspRelays(
  event: NostrEvent,
  relayUrls: string[],
): Promise<void> {
  if (relayUrls.length === 0) {
    throw new Error("No Grasp relay URLs available");
  }

  const responses = await relayPool.publish(relayUrls, event);
  const accepted = responses.filter((r) => r.ok);
  if (accepted.length === 0) {
    const reasons = responses
      .map((r) => `${r.from}: ${r.message ?? "rejected"}`)
      .join("; ");
    throw new Error(`All Grasp relays rejected the state event: ${reasons}`);
  }
}

async function fetchPRBranchObjectsWithTimeout(
  gitPool: GitGraspPool,
  tipCommitHash: string,
  stopAtCommitHash: string,
  fallbackUrls: string[],
): Promise<PackableObject[] | null> {
  const abort = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, PR_BRANCH_OBJECT_FETCH_TIMEOUT_MS);

  try {
    const objects = await gitPool.getPackableObjectsForCommitRange(
      tipCommitHash,
      stopAtCommitHash,
      abort.signal,
      fallbackUrls,
    );

    if (timedOut) {
      throw new Error(
        "Timed out while fetching PR branch objects from the git server. " +
          "Try again, or merge locally with ngit if the server remains slow.",
      );
    }

    return objects;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchIssueScanObjectsForStateDelta(
  gitPool: GitGraspPool,
  currentStateEvent: NostrEvent | null | undefined,
  defaultBranchName: string,
  defaultBranchHead: string,
  fallbackUrls: string[],
): Promise<PackableObject[]> {
  const oldStateHead = currentStateEvent
    ? getStateRefs(currentStateEvent).find(
        (ref) => ref.name === `refs/heads/${defaultBranchName}`,
      )?.commitId
    : undefined;
  if (!oldStateHead || oldStateHead === defaultBranchHead) return [];

  const abort = new AbortController();
  const timeout = globalThis.setTimeout(
    () => abort.abort(),
    ISSUE_STATE_DELTA_FETCH_TIMEOUT_MS,
  );

  try {
    const history = await gitPool.getCommitHistory(
      defaultBranchHead,
      ISSUE_STATE_DELTA_MAX_DEPTH,
      abort.signal,
      fallbackUrls,
      oldStateHead,
    );
    if (!history?.some((commit) => commit.hash === oldStateHead)) return [];

    return (
      (await gitPool.getPackableObjectsForCommitRange(
        defaultBranchHead,
        oldStateHead,
        abort.signal,
        fallbackUrls,
        ISSUE_STATE_DELTA_MAX_DEPTH,
      )) ?? []
    );
  } catch {
    return [];
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

const STEP_LABELS: Record<MergeStep, string> = {
  idle: "",
  building: "Building merge commit...",
  "publishing-state": "Publishing state to Grasp...",
  pushing: "Pushing to git server...",
  "publishing-status": "Publishing merged status...",
  "broadcasting-state": "Broadcasting state event...",
  done: "Complete!",
  failed: "Failed",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MergePanel({
  pr,
  repo,
  patchChain,
  gitPool,
  effectiveCloneUrls,
  behindCount,
  defaultBranchName,
  defaultBranchHead,
  currentStateEvent,
  guessedBaseCommitId,
  prNevent,
  issues,
  onSuccessfulPush,
}: MergePanelProps) {
  const account = useActiveAccount();
  const profile = useMyProfile();
  const { toast } = useToast();

  // The PR/patch author's profile — used for the `PR-Author:` trailer in the
  // merge commit message. Only a real human name is surfaced (matching
  // `ngit merge`); when none is known the trailer carries just the npub.
  const authorProfile = useProfile(pr.pubkey);
  const rootAuthorName =
    authorProfile?.displayName || authorProfile?.name || undefined;

  // Merge step tracking
  const [mergeStep, setMergeStep] = useState<MergeStep>("idle");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [pushDelivery, setPushDelivery] = useState<PushDeliverySummary | null>(
    null,
  );

  const hasAdditionalGitServers = repo.additionalGitServerUrls.length > 0;
  const supportsBrowserMerge =
    repo.graspCloneUrls.length > 0 && !hasAdditionalGitServers;
  const localMergeCommand = `ngit merge ${pr.rootEvent.id.slice(0, 8)} && git push`;
  const gitServerName = formatGitServerName(repo.additionalGitServerUrls);
  const localMergeReason = hasAdditionalGitServers
    ? `This repository also lists ${gitServerName} as a git server, so gitworkshop can't safely update every advertised server.`
    : `This repository uses ${gitServerName}, so merging directly from gitworkshop isn't supported.`;

  // Committer identity for browser-created commits. The memoised value feeds
  // the mergeability hooks (which pre-build objects); the builder is called
  // again at click time so pushed commits carry the actual merge time.
  const buildCommitterNow = useCallback((): CommitPerson | undefined => {
    if (!account) return undefined;
    return createCommitPersonNow(
      profile?.displayName || profile?.name || "Anonymous",
      profile?.nip05 ?? `${nip19.npubEncode(account.pubkey)}@nostr`,
    );
  }, [account, profile]);

  const maintainerCommitter = useMemo(
    () => buildCommitterNow(),
    [buildCommitterNow],
  );

  const isPRType = pr.itemType === "pr";

  const patchEventIds = useMemo(
    () =>
      (patchChain ?? []).map((patch) => ({
        id: patch.event.id,
        pubkey: patch.pubkey,
      })),
    [patchChain],
  );

  // Issue auto-resolution context (ngit parity): commit messages landing on
  // the default branch are scanned for resolution keywords against the repo's
  // open/draft issues. Resolved/closed/deleted issues are filtered here so
  // the merge never re-resolves them.
  const issueAutoResolve = useMemo<IssueAutoResolveContext | undefined>(() => {
    if (!issues?.length) return undefined;
    const candidates: IssueCandidate[] = issues
      .filter((issue) => issue.status === "open" || issue.status === "draft")
      .map((issue) => ({
        id: issue.id,
        pubkey: issue.pubkey,
        status: issue.status,
      }));
    if (candidates.length === 0) return undefined;
    return { issues: candidates, maintainers: repo.maintainerSet };
  }, [issues, repo.maintainerSet]);

  const patchTipCommitId = useMemo(() => {
    if (isPRType || !patchChain?.length) return undefined;
    return patchChain[patchChain.length - 1]?.commitId;
  }, [isPRType, patchChain]);

  const detectionTipCommitId = isPRType ? pr.tip.commitId : patchTipCommitId;
  const detectionStopCommitId = isPRType
    ? pr.tip.explicitMergeBase
    : patchChain?.[0]?.parentCommitId;

  // Eagerly check mergeability — both strategies in parallel (patch-type only)
  const patchMergeability = usePatchMergeability(
    isPRType ? undefined : patchChain,
    gitPool,
    effectiveCloneUrls,
    !isPRType,
    guessedBaseCommitId,
    defaultBranchHead,
    maintainerCommitter,
  );

  // PR-type mergeability: fetch tip tree and pre-build merge commit
  const coverNoteBody = pr.coverNote?.content || undefined;
  const prBody = pr.body || undefined;
  const prMergeability = usePRMergeability(
    isPRType ? pr.tip.commitId : undefined,
    defaultBranchHead,
    maintainerCommitter,
    pr.rootEvent.id,
    pr.currentSubject || pr.originalSubject,
    prNevent ?? "",
    pr.pubkey,
    rootAuthorName,
    coverNoteBody,
    prBody,
    gitPool,
    effectiveCloneUrls,
    isPRType,
    pr.tip.explicitMergeBase,
  );

  // Unified mergeability view for the render logic
  const mergeability = isPRType
    ? {
        status: prMergeability.status as
          | MergeabilityStatus
          | PRMergeabilityStatus,
        buildResult: null,
        applyResult: null,
        conflicts: prMergeability.conflicts,
        errorMessage: prMergeability.errorMessage,
        mergeStrategyError: null,
        mergeBaseMismatch: prMergeability.mergeBaseMismatch,
        recheck: prMergeability.recheck,
      }
    : {
        ...patchMergeability,
        status: patchMergeability.status as
          | MergeabilityStatus
          | PRMergeabilityStatus,
        mergeBaseMismatch: null,
      };

  const shouldScanForMissingMergedStatus =
    mergeStep === "idle" &&
    (pr.status === "open" || pr.status === "draft") &&
    (mergeability.status === "ready" ||
      mergeability.status === "already-merged" ||
      mergeability.status === "ready-apply-only" ||
      mergeability.status === "conflicts" ||
      (!supportsBrowserMerge && mergeability.status !== "loading"));

  // Best-effort scan for an ngit-style merge commit whose kind:1631 merged
  // status never made it to the relays.
  const {
    detectedMergeCommit,
    scanResult: detectedMergeScanResult,
    detecting: detectingMergeCommit,
    lookBackFurther,
    lookbackStep,
  } = useDetectedMergeCommit({
    gitPool,
    defaultBranchHead,
    rootEventId: pr.rootEvent.id,
    fallbackUrls: effectiveCloneUrls,
    enabled: shouldScanForMissingMergedStatus,
    tipCommitId: detectionTipCommitId,
    stopAtCommitId: detectionStopCommitId,
  });

  const mergeabilityCheckWillStart =
    supportsBrowserMerge &&
    mergeStep === "idle" &&
    mergeability.status === "idle" &&
    (isPRType ? !!pr.tip.commitId : !!patchChain?.length);

  const displayedStatus: MergePanelStatus = detectedMergeCommit
    ? "detected-merged"
    : mergeabilityCheckWillStart
      ? "loading"
      : mergeability.status;

  // Grasp relay URLs: repo relays whose hostname matches a Grasp server domain
  const graspRelayUrls = useMemo(
    () => repo.relays.filter((r) => isGraspRelay(r, repo.graspServerDomains)),
    [repo.relays, repo.graspServerDomains],
  );

  // Can we show the merge button?
  const canMerge =
    supportsBrowserMerge &&
    !detectedMergeCommit &&
    mergeability.status === "ready" &&
    defaultBranchHead &&
    mergeStep === "idle";

  // Can we show the apply-to-tip button? (patch-type only)
  const canApplyToTip =
    supportsBrowserMerge &&
    !detectedMergeCommit &&
    !isPRType &&
    mergeability.status === "ready-apply-only" &&
    defaultBranchHead &&
    mergeStep === "idle";

  const canShowLocalMerge =
    !supportsBrowserMerge && !detectedMergeCommit && mergeStep === "idle";

  const canMarkDetectedMerged =
    !!account && !!detectedMergeCommit && mergeStep === "idle";

  const copyLocalMergeCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(localMergeCommand);
      toast({
        title: "Local merge command copied",
        description: localMergeCommand,
      });
    } catch {
      toast({
        title: "Could not copy command",
        description: localMergeCommand,
        variant: "destructive",
      });
    }
  }, [localMergeCommand, toast]);

  // ── Shared merge wiring ──────────────────────────────────────────────────

  /**
   * Build the transports every merge strategy runs against: state events go
   * to the Grasp relays (purgatory), the push fans out to every Grasp server
   * via the pool, and status/state broadcasts go through the outbox. The
   * returned `getPushSummary` exposes the delivery summary for the success
   * toast.
   */
  const createMergeTransports = useCallback(
    (accountPubkey: string) => {
      let pushSummary: PushDeliverySummary | null = null;

      const transports: GraspMergeTransports = {
        publishStateToGrasp: (state) =>
          publishToGraspRelays(state, graspRelayUrls),
        pushObjects: async (objects, refUpdate) => {
          if (!gitPool) throw new Error("Git pool unavailable");
          const summary = await gitPool.pushRefUpdate(objects, refUpdate, {
            targetCloneUrls: repo.graspCloneUrls,
            currentStateEvent,
          });
          pushSummary = summary;
          setPushDelivery(summary);
          onSuccessfulPush?.();
        },
        publishStatusBroadly: (status) =>
          outboxStore.publish(status, [
            `outbox:${accountPubkey}`,
            ...repo.allCoordinates,
            ...(pr.pubkey !== accountPubkey ? [`inbox:${pr.pubkey}`] : []),
          ]),
        publishIssueStatus: (status, issue) =>
          outboxStore.publish(status, [
            `outbox:${accountPubkey}`,
            ...repo.allCoordinates,
            ...(issue.pubkey !== accountPubkey
              ? [`inbox:${issue.pubkey}`]
              : []),
          ]),
        broadcastStateBroadly: (state) =>
          outboxStore.publish(state, [
            `outbox:${accountPubkey}`,
            ...repo.allCoordinates,
            "fallback-relays",
          ]),
        onEvent: (event) => eventStore.add(event),
        onStep: (step) => setMergeStep(step),
      };

      return { transports, getPushSummary: () => pushSummary };
    },
    [
      gitPool,
      graspRelayUrls,
      repo.graspCloneUrls,
      repo.allCoordinates,
      currentStateEvent,
      pr.pubkey,
      onSuccessfulPush,
    ],
  );

  const beginMerge = useCallback(() => {
    setMergeStep("building");
    setMergeError(null);
    setPushDelivery(null);
  }, []);

  const failMerge = useCallback(
    (err: unknown, title: string, fallbackMessage: string) => {
      const message = err instanceof Error ? err.message : fallbackMessage;
      setMergeStep("failed");
      setMergeError(message);
      toast({ title, description: message, variant: "destructive" });
    },
    [toast],
  );

  const publishMergedStatus = useCallback(
    async (mergeCommitHash: string): Promise<void> => {
      if (!account) return;

      const signedStatus = await signMergedStatus({
        signer: account.signer,
        signerPubkey: account.pubkey,
        rootEventId: pr.rootEvent.id,
        repoCoords: pr.repoCoords,
        rootAuthorPubkey: pr.pubkey,
        mergeCommitHash,
        patchEventIds,
      });

      await outboxStore.publish(signedStatus, [
        `outbox:${account.pubkey}`,
        ...repo.allCoordinates,
        ...(pr.pubkey !== account.pubkey ? [`inbox:${pr.pubkey}`] : []),
      ]);
      eventStore.add(signedStatus);
    },
    [account, patchEventIds, pr, repo.allCoordinates],
  );

  const handleMarkDetectedMerged = useCallback(async () => {
    if (!account || !detectedMergeCommit) return;

    setMergeStep("publishing-status");
    setMergeError(null);
    setPushDelivery(null);

    try {
      await publishMergedStatus(detectedMergeCommit.hash);
      setMergeStep("done");
      toast({
        title: "Marked as merged",
        description: `Detected merge commit ${detectedMergeCommit.hash.slice(0, 8)} and published the missing merged status.`,
      });
    } catch (err) {
      failMerge(
        err,
        "Could not mark as merged",
        "Could not publish merged status",
      );
    }
  }, [account, detectedMergeCommit, publishMergedStatus, failMerge, toast]);

  // ── Merge orchestration (patch-type merge strategy) ─────────────────────

  const handleMerge = useCallback(async () => {
    if (
      !account ||
      !mergeability.buildResult ||
      !defaultBranchHead ||
      !gitPool
    ) {
      return;
    }

    beginMerge();

    try {
      const committer = buildCommitterNow();
      if (!committer) return;

      const { transports, getPushSummary } = createMergeTransports(
        account.pubkey,
      );
      const issueScanObjects = issueAutoResolve
        ? await fetchIssueScanObjectsForStateDelta(
            gitPool,
            currentStateEvent,
            defaultBranchName,
            defaultBranchHead,
            effectiveCloneUrls,
          )
        : [];

      const { mergeCommit, issueStatuses } = await performMerge({
        signer: account.signer,
        signerPubkey: account.pubkey,
        chainObjects: mergeability.buildResult.objects,
        finalTreeHash: mergeability.buildResult.finalTreeHash,
        tipCommitHash: mergeability.buildResult.tipCommitHash,
        dTag: repo.dTag,
        defaultBranchName,
        defaultBranchHead,
        currentStateEvent,
        repoCoords: pr.repoCoords,
        rootEventId: pr.rootEvent.id,
        rootAuthorPubkey: pr.pubkey,
        issueScanObjects,
        issueAutoResolve,
        subject: pr.currentSubject || pr.originalSubject,
        prNevent: buildPRNevent(pr.rootEvent.id, pr.pubkey, repo.relays),
        rootAuthorName,
        // Cover note takes precedence over the PR body in the merge commit
        // message (recorded under different headings — see buildMergeCommitMessage).
        coverNote: pr.coverNote?.content || undefined,
        prDescription: pr.body || undefined,
        committer,
        patchEventIds,
        ...transports,
      });

      const summary = getPushSummary();
      toast({
        title: "Patch merged",
        description: `Merge commit ${mergeCommit.hash.slice(0, 8)} pushed to ${defaultBranchName}.${summary ? ` ${summarizePushDelivery(summary)}` : ""}${formatResolvedIssuesSuffix(issueStatuses.length)}`,
      });
    } catch (err) {
      failMerge(err, "Merge failed", "Merge failed unexpectedly");
    }
  }, [
    account,
    mergeability.buildResult,
    defaultBranchHead,
    currentStateEvent,
    defaultBranchName,
    gitPool,
    effectiveCloneUrls,
    pr,
    patchEventIds,
    issueAutoResolve,
    repo,
    rootAuthorName,
    beginMerge,
    buildCommitterNow,
    createMergeTransports,
    failMerge,
    toast,
  ]);

  // ── Apply-to-tip orchestration ────────────────────────────────────────────

  const handleApplyToTip = useCallback(async () => {
    if (
      !account ||
      !mergeability.applyResult ||
      !defaultBranchHead ||
      !gitPool
    ) {
      return;
    }

    beginMerge();

    try {
      const { transports, getPushSummary } = createMergeTransports(
        account.pubkey,
      );
      const issueScanObjects = issueAutoResolve
        ? await fetchIssueScanObjectsForStateDelta(
            gitPool,
            currentStateEvent,
            defaultBranchName,
            defaultBranchHead,
            effectiveCloneUrls,
          )
        : [];

      const { newTipCommitHash, issueStatuses } = await performApplyToTip({
        signer: account.signer,
        signerPubkey: account.pubkey,
        objects: mergeability.applyResult.objects,
        newTipCommitHash: mergeability.applyResult.newTipCommitHash,
        dTag: repo.dTag,
        defaultBranchName,
        defaultBranchHead,
        currentStateEvent,
        repoCoords: pr.repoCoords,
        rootEventId: pr.rootEvent.id,
        rootAuthorPubkey: pr.pubkey,
        issueScanObjects,
        issueAutoResolve,
        patchEventIds,
        ...transports,
      });

      const summary = getPushSummary();
      const patchCount = patchChain?.length ?? 0;
      toast({
        title: "Patch applied",
        description: `${patchCount} commit${patchCount !== 1 ? "s" : ""} applied to ${defaultBranchName} (tip: ${newTipCommitHash.slice(0, 8)}).${summary ? ` ${summarizePushDelivery(summary)}` : ""}${formatResolvedIssuesSuffix(issueStatuses.length)}`,
      });
    } catch (err) {
      failMerge(err, "Apply failed", "Apply failed unexpectedly");
    }
  }, [
    account,
    mergeability.applyResult,
    defaultBranchHead,
    currentStateEvent,
    defaultBranchName,
    gitPool,
    effectiveCloneUrls,
    pr,
    patchChain,
    patchEventIds,
    issueAutoResolve,
    repo,
    beginMerge,
    createMergeTransports,
    failMerge,
    toast,
  ]);

  // ── PR merge orchestration ────────────────────────────────────────────────

  const handlePRMerge = useCallback(async () => {
    if (
      !account ||
      !prMergeability.result ||
      !defaultBranchHead ||
      !gitPool ||
      !pr.tip.commitId
    ) {
      return;
    }

    beginMerge();

    try {
      const { transports, getPushSummary } = createMergeTransports(
        account.pubkey,
      );
      const issueScanObjects = issueAutoResolve
        ? await fetchIssueScanObjectsForStateDelta(
            gitPool,
            currentStateEvent,
            defaultBranchName,
            defaultBranchHead,
            effectiveCloneUrls,
          )
        : [];

      const { mergeCommit, issueStatuses } = await performPRMerge({
        signer: account.signer,
        signerPubkey: account.pubkey,
        mergeCommitObj: prMergeability.result.mergeCommitObj,
        prTipCommitHash: pr.tip.commitId,
        mergeBase: prMergeability.result.mergeBase,
        extraObjects: prMergeability.result.extraObjects,
        dTag: repo.dTag,
        defaultBranchName,
        defaultBranchHead,
        currentStateEvent,
        repoCoords: pr.repoCoords,
        rootEventId: pr.rootEvent.id,
        rootAuthorPubkey: pr.pubkey,
        issueScanObjects,
        issueAutoResolve,
        fetchBranchObjects: (tipCommitHash, stopAtCommitHash) =>
          fetchPRBranchObjectsWithTimeout(
            gitPool,
            tipCommitHash,
            stopAtCommitHash,
            effectiveCloneUrls,
          ),
        ...transports,
      });

      const summary = getPushSummary();
      toast({
        title: "PR merged",
        description: `Merge commit ${mergeCommit.hash.slice(0, 8)} pushed to ${defaultBranchName}.${summary ? ` ${summarizePushDelivery(summary)}` : ""}${formatResolvedIssuesSuffix(issueStatuses.length)}`,
      });
    } catch (err) {
      failMerge(err, "Merge failed", "Merge failed unexpectedly");
    }
  }, [
    account,
    prMergeability.result,
    defaultBranchHead,
    currentStateEvent,
    defaultBranchName,
    gitPool,
    effectiveCloneUrls,
    pr,
    issueAutoResolve,
    repo,
    beginMerge,
    createMergeTransports,
    failMerge,
    toast,
  ]);

  // ── Render ──────────────────────────────────────────────────────────────

  const isMerging =
    mergeStep !== "idle" && mergeStep !== "done" && mergeStep !== "failed";

  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <StatusIcon status={displayedStatus} mergeStep={mergeStep} />
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            {/* Status headline */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <StatusHeadline
                  status={displayedStatus}
                  mergeStep={mergeStep}
                  mergeError={mergeError}
                  defaultBranchName={defaultBranchName}
                  behindCount={behindCount}
                  allHashesVerified={
                    mergeability.buildResult?.allHashesVerified ??
                    mergeability.applyResult?.allHashesVerified ??
                    false
                  }
                  isBaseGuessed={!!guessedBaseCommitId}
                  isPRType={isPRType}
                />
              </div>

              {/* Action buttons / recheck */}
              <div className="shrink-0 flex items-center gap-2">
                {displayedStatus === "loading" && (
                  <span className="text-xs text-muted-foreground">
                    Checking...
                  </span>
                )}

                {detectingMergeCommit && !detectedMergeCommit && (
                  <span className="text-xs text-muted-foreground">
                    Checking recent history...
                  </span>
                )}

                {(mergeability.status === "error" ||
                  mergeability.status === "conflicts" ||
                  mergeStep === "failed") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setMergeStep("idle");
                      setMergeError(null);
                      setPushDelivery(null);
                      mergeability.recheck();
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Recheck
                  </Button>
                )}

                {canMarkDetectedMerged && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        className="h-8 bg-green-600 hover:bg-green-700 text-white"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                        Mark merged
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Mark this PR as merged?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-2 text-sm text-muted-foreground">
                            <p>
                              We found a recent ngit-style merge commit on{" "}
                              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                                {defaultBranchName}
                              </code>{" "}
                              that references this {isPRType ? "PR" : "patch"}.
                            </p>
                            <p>
                              This will not push git objects or change the
                              branch. It only publishes the missing merged
                              status event.
                            </p>
                            <p className="font-mono text-xs text-foreground">
                              {detectedMergeCommit.hash.slice(0, 8)} {" — "}
                              {detectedMergeCommit.subject || "merge commit"}
                            </p>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleMarkDetectedMerged}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                          Publish merged status
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {canMerge && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        className="h-8 bg-green-600 hover:bg-green-700 text-white"
                      >
                        <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                        Merge
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Merge this {isPRType ? "PR" : "patch"}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will create a merge commit on{" "}
                          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                            {defaultBranchName}
                          </code>{" "}
                          and push it to the Grasp server
                          {repo.graspCloneUrls.length > 1 ? "s" : ""}.
                          {behindCount !== undefined && behindCount > 0 && (
                            <>
                              {" "}
                              The default branch is{" "}
                              <strong>
                                {behindCount} commit
                                {behindCount !== 1 ? "s" : ""}
                              </strong>{" "}
                              ahead of the {isPRType ? "PR" : "patch"} base.
                              {isPRType && (
                                <>
                                  {" "}
                                  Consider updating the PR branch first to avoid
                                  an outdated merge tree.
                                </>
                              )}
                            </>
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={isPRType ? handlePRMerge : handleMerge}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                          Confirm merge
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {canShowLocalMerge && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                        onClick={copyLocalMergeCommand}
                      >
                        <Terminal className="h-3.5 w-3.5 mr-1.5" />
                        Local merge only
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Copy local merge command
                    </TooltipContent>
                  </Tooltip>
                )}

                {canApplyToTip && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        className="h-8 bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                        Apply to Tip
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Apply patches to tip?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-2 text-sm text-muted-foreground">
                            <p>
                              The patches could not be merged cleanly against
                              their original base, but they apply cleanly on top
                              of{" "}
                              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                                {defaultBranchName}
                              </code>
                              .
                            </p>
                            <p>
                              This will replay the patch commits directly on top
                              of the current branch tip (like{" "}
                              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                                git am
                              </code>
                              ), producing a linear history with no merge
                              commit. The original author and timestamps are
                              preserved; you will be recorded as the committer.
                            </p>
                            {mergeability.mergeStrategyError && (
                              <p className="text-amber-600 dark:text-amber-400 text-xs">
                                Merge strategy failed:{" "}
                                {mergeability.mergeStrategyError}
                              </p>
                            )}
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleApplyToTip}
                          className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                          Confirm apply
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {isMerging && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="text-xs">{STEP_LABELS[mergeStep]}</span>
                  </div>
                )}

                {mergeStep === "done" && (
                  <div className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Done</span>
                  </div>
                )}
              </div>
            </div>

            {/* Stale claimed merge-base warning */}
            {mergeStep === "idle" &&
              !detectedMergeCommit &&
              mergeability.mergeBaseMismatch && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p>
                        <span className="font-medium">
                          Incorrect merge base in PR.
                        </span>{" "}
                        The PR's recorded{" "}
                        <code className="rounded bg-muted px-0.5 font-mono text-[10px]">
                          merge-base
                        </code>{" "}
                        does not match the common ancestor computed from git
                        history. The PR author's tooling likely miscalculated it
                        — treat the PR's metadata with caution.
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        claimed{" "}
                        {mergeability.mergeBaseMismatch.claimed.slice(0, 8)} ·
                        computed{" "}
                        {mergeability.mergeBaseMismatch.computed.slice(0, 8)}
                      </p>
                      <p>
                        This merge uses the computed base, so no commits will be
                        orphaned.
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {/* Already-merged detection hit its look-back cap */}
            {!detectedMergeCommit &&
              !detectingMergeCommit &&
              detectedMergeScanResult?.hitLimit &&
              mergeStep === "idle" && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p>
                        <span className="font-medium">
                          Already-merged check stopped after{" "}
                          {detectedMergeScanResult.scannedCount} commits.
                        </span>{" "}
                        {detectionStopCommitId
                          ? "It did not reach the stated merge base, so this item may already be merged further back in history."
                          : "Older merges are possible but unlikely unless this repository has very high activity."}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 border-amber-500/40 px-2 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                          onClick={lookBackFurther}
                        >
                          Look back further
                        </Button>
                        <span className="text-[10px] text-muted-foreground">
                          Next scan checks up to{" "}
                          {detectedMergeScanResult.maxTotal + lookbackStep}{" "}
                          commits.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            {/* Best-effort already-merged detection */}
            {detectedMergeCommit && mergeStep === "idle" && (
              <div className="rounded-md border border-green-600/30 bg-green-600/5 px-3 py-2 text-xs text-green-700 dark:text-green-400">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p>
                      <span className="font-medium">
                        This {isPRType ? "PR" : "patch"} appears to already be
                        merged.
                      </span>{" "}
                      We found a recent ngit-style merge commit on{" "}
                      <code className="rounded bg-muted px-0.5 font-mono text-[10px] text-foreground">
                        {defaultBranchName}
                      </code>
                      , but no merged status event is present yet.
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {detectedMergeCommit.hash.slice(0, 8)} {" — "}
                      {detectedMergeCommit.subject || "merge commit"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* GRASP push delivery summary */}
            {mergeStep === "done" && pushDelivery && (
              <PushDeliverySummaryView summary={pushDelivery} />
            )}

            {/* Local merge guidance for non-GRASP git servers */}
            {canShowLocalMerge && (
              <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm">
                <p className="text-muted-foreground">
                  {localMergeReason} To merge, run this from your local repo:
                </p>
                <button
                  type="button"
                  className="mt-2 block w-full rounded-md bg-background px-3 py-2 text-left font-mono text-xs text-foreground ring-1 ring-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={copyLocalMergeCommand}
                >
                  {localMergeCommand}
                </button>
              </div>
            )}

            {/* Apply-to-tip warning banner */}
            {mergeability.status === "ready-apply-only" &&
              mergeability.mergeStrategyError && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">
                        Merge strategy unavailable.
                      </span>{" "}
                      Patches apply cleanly against the current tip but not
                      against the original base (
                      {mergeability.mergeStrategyError}
                      ). Applying will produce a linear history without a merge
                      commit.
                    </div>
                  </div>
                </div>
              )}

            {/* Conflict details */}
            {mergeability.status === "conflicts" &&
              mergeability.conflicts.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                  <p className="font-medium text-destructive mb-1">
                    Conflicting files:
                  </p>
                  <ul className="space-y-0.5">
                    {mergeability.conflicts.map((c, i) => (
                      <li
                        key={i}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {c.path}
                        <span className="text-destructive/70 ml-2">
                          — {c.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {/* Error details */}
            {mergeStep === "failed" && mergeError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {mergeError}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PushDeliverySummaryView({
  summary,
}: {
  summary: PushDeliverySummary;
}) {
  return (
    <div className="rounded-md border border-green-600/30 bg-green-600/5 px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium text-green-700 dark:text-green-400">
            {summarizePushDelivery(summary)}
          </p>
          <ul className="space-y-1 text-xs">
            {summary.outcomes.map((outcome) => (
              <li
                key={outcome.cloneUrl}
                className="flex items-start gap-2 text-muted-foreground"
              >
                {outcome.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />
                ) : (
                  <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">
                    {formatCloneUrlHost(outcome.cloneUrl)}
                  </span>
                  : {outcome.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatusIcon({
  status,
  mergeStep,
}: {
  status: MergePanelStatus;
  mergeStep: MergeStep;
}) {
  if (mergeStep === "done") {
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  }
  if (mergeStep !== "idle" && mergeStep !== "failed") {
    return <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />;
  }
  if (mergeStep === "failed") {
    return <XCircle className="h-5 w-5 text-destructive" />;
  }

  switch (status) {
    case "loading":
      return <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />;
    case "ready":
    case "already-merged":
    case "detected-merged":
      return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    case "ready-apply-only":
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    case "conflicts":
      return <XCircle className="h-5 w-5 text-destructive" />;
    case "error":
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    default:
      return <GitMerge className="h-5 w-5 text-muted-foreground" />;
  }
}

function StatusHeadline({
  status,
  mergeStep,
  mergeError,
  defaultBranchName,
  behindCount,
  allHashesVerified,
  isBaseGuessed,
  isPRType,
}: {
  status: MergePanelStatus;
  mergeStep: MergeStep;
  mergeError: string | null;
  defaultBranchName: string;
  behindCount: number | undefined;
  allHashesVerified: boolean;
  isBaseGuessed: boolean;
  isPRType: boolean;
}) {
  if (mergeStep === "done") {
    return (
      <p className="text-sm font-medium text-green-600">
        {isPRType ? "PR" : "Patch"} merged into{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {defaultBranchName}
        </code>
      </p>
    );
  }

  if (mergeStep === "failed") {
    return <p className="text-sm font-medium text-destructive">Failed</p>;
  }

  if (mergeStep !== "idle") {
    return (
      <p className="text-sm text-muted-foreground">{STEP_LABELS[mergeStep]}</p>
    );
  }

  switch (status) {
    case "loading":
      return (
        <p className="text-sm text-muted-foreground">
          Checking if this {isPRType ? "PR" : "patch"} can be merged into{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {defaultBranchName}
          </code>
          ...
        </p>
      );
    case "ready":
      return (
        <div>
          <p className="text-sm font-medium text-green-600">
            Ready to merge into{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              {defaultBranchName}
            </code>
          </p>
          {behindCount !== undefined && behindCount > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">
              {isPRType
                ? `Default branch is ${behindCount} commit${behindCount !== 1 ? "s" : ""} ahead of the PR base. Consider updating the PR branch first.`
                : `Default branch is ${behindCount} commit${behindCount !== 1 ? "s" : ""} ahead of the patch base, but patches apply cleanly.`}
            </p>
          )}
          {!isPRType && isBaseGuessed && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 flex items-center gap-1">
              <Info className="h-3 w-3 shrink-0" />
              Merge base approximated from patch timestamp (no{" "}
              <code className="rounded bg-muted px-0.5 font-mono text-[10px]">
                parent-commit
              </code>{" "}
              tag).
            </p>
          )}
          {!isPRType && !allHashesVerified && (
            <p className="text-xs text-amber-600 mt-0.5">
              Diffs applied correctly. Tooling produced commit ID mismatch but
              for cosmetic reasons only (GPG signatures, whitespace, timezone
              encoding).
            </p>
          )}
        </div>
      );
    case "detected-merged":
      return (
        <div>
          <p className="text-sm font-medium text-green-600">
            Detected already merged into{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              {defaultBranchName}
            </code>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Publish the missing merged status event to update this PR.
          </p>
        </div>
      );
    case "already-merged":
      return (
        <div>
          <p className="text-sm font-medium text-green-600">
            PR tip is already reachable from{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              {defaultBranchName}
            </code>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The PR tip is in the branch history; checking for a missing merged
            status event.
          </p>
        </div>
      );
    case "ready-apply-only":
      return (
        <p className="text-sm font-medium text-amber-600 dark:text-amber-500">
          Patches apply cleanly to tip of{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            {defaultBranchName}
          </code>
        </p>
      );
    case "conflicts":
      return (
        <p className="text-sm font-medium text-destructive">
          This patch has conflicts with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            {defaultBranchName}
          </code>
        </p>
      );
    case "error":
      return (
        <div>
          <p className="text-sm text-amber-600">
            Could not determine mergeability
            {mergeError ? `: ${mergeError}` : ""}
          </p>
          {isBaseGuessed && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 flex items-center gap-1">
              <Info className="h-3 w-3 shrink-0" />
              Merge base was approximated from patch timestamp — it may be
              incorrect.
            </p>
          )}
        </div>
      );
    default:
      return (
        <p className="text-sm text-muted-foreground">
          Merge status unavailable
        </p>
      );
  }
}
