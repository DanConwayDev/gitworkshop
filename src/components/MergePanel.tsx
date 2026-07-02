/**
 * MergePanel — merge/apply button and status panel for patch-type PRs on Grasp repos.
 *
 * Shown at the bottom of the conversation tab, above the reply box. Eagerly
 * checks whether the patch chain can be merged or applied and shows one of:
 *   - "Ready to merge" with a green Merge button (merge strategy succeeded)
 *   - "Apply to Tip" with an amber Apply button + warning (only apply-to-tip works)
 *   - "Conflicts detected" with file-level details
 *   - "Error" with a human-readable message
 *
 * Two strategies are tried in parallel:
 *
 *   **Merge** (preferred): applies patches against the original merge-base
 *   (parent-commit tag, or timestamp-guessed), then creates a merge commit
 *   with two parents (defaultBranchHead + patchTipCommit). Preserves history.
 *
 *   **Apply to Tip**: applies patches directly on top of the current default
 *   branch HEAD, producing linear commits (no merge commit). Used as a fallback
 *   when the merge strategy fails (e.g. guessed base is wrong, or the patch
 *   doesn't apply cleanly against the original base).
 *
 * The merge orchestration sequence (merge strategy):
 *   1. Build merge commit (pure computation, sub-millisecond)
 *   2. Publish kind:30618 state event to Grasp relays ONLY (purgatory)
 *   3. Push packfile to Grasp git server(s)
 *   4. Publish kind:1631 merged status event to all relay groups
 *   5. Publish kind:30618 to remaining relays (user outbox, repo relays)
 *
 * The apply-to-tip sequence:
 *   1. (Objects already built in usePatchMergeability)
 *   2. Publish kind:30618 state event to Grasp relays ONLY (purgatory)
 *   3. Push packfile to Grasp git server(s)
 *   4. Publish kind:1631 merged status event to all relay groups
 *   5. Publish kind:30618 to remaining relays
 *
 * If step 3 fails, the state event expires from purgatory after 30 minutes.
 * No manual rollback needed.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
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
import { createPackfile, type PackableObject } from "@/lib/git-packfile";
import {
  getReceivePackRefs,
  pushToGitServer,
  type RefUpdate,
} from "@/lib/git-push";
import { performMerge } from "@/lib/perform-merge";
import { assertFastForwardSafe } from "@/lib/patch-merge";
import { pool as relayPool, eventStore } from "@/services/nostr";
import { outboxStore } from "@/services/outbox";

import { RepoStateFactory } from "@/factories/RepoStateFactory";
import {
  StatusChangeFactory,
  STATUS_KIND_MAP,
} from "@/factories/StatusChangeFactory";
import type { CommitPerson } from "@/lib/git-objects";
import type { Patch } from "@/casts/Patch";
import type { Commit, GitGraspPool } from "@/lib/git-grasp-pool";
import type { ResolvedRepo, ResolvedPR } from "@/lib/nip34";

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

interface DetectedMergeCommit {
  hash: string;
  subject: string;
}

interface PushDeliveryOutcome {
  cloneUrl: string;
  ok: boolean;
  message: string;
}

interface PushDeliverySummary {
  outcomes: PushDeliveryOutcome[];
  successCount: number;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Commit-history batch size. Matches git-grasp-pool's default merge-base/count
 * batch size so this usually reuses history already fetched for PR mergeability
 * and behind-count checks.
 */
const DETECTED_MERGE_HISTORY_BATCH_SIZE = 200;

/** Hard cap when an explicit base lets us safely walk deeper in batches. */
const DETECTED_MERGE_HISTORY_MAX_WITH_BASE = 5000;

function firstCommitSubject(message: string): string {
  return message.split("\n", 1)[0]?.trim() ?? "";
}

function messageReferencesRootEvent(
  message: string,
  rootEventId: string,
): boolean {
  const re = /nostr:(nevent1[023456789acdefghjklmnpqrstuvwxyz]+)/g;
  for (const match of message.matchAll(re)) {
    const nevent = match[1];
    if (!nevent) continue;
    try {
      const decoded = nip19.decode(nevent);
      if (decoded.type === "nevent" && decoded.data.id === rootEventId) {
        return true;
      }
    } catch {
      // Ignore malformed nostr: lines in arbitrary commit messages.
    }
  }
  return false;
}

function findDetectedNgitMergeCommit(
  commits: Commit[],
  rootEventId: string,
  tipCommitId?: string,
): DetectedMergeCommit | null {
  const mergeSubjectPrefix = `Merge #${rootEventId.slice(0, 8)}:`;

  for (const commit of commits) {
    if (commit.parents.length < 2) continue;
    if (tipCommitId && !commit.parents.includes(tipCommitId)) continue;

    const subject = firstCommitSubject(commit.message);
    const referencesRoot =
      subject.startsWith(mergeSubjectPrefix) ||
      messageReferencesRootEvent(commit.message, rootEventId);

    if (referencesRoot) {
      return { hash: commit.hash, subject };
    }
  }

  return null;
}

async function findDetectedNgitMergeCommitInHistory(
  gitPool: GitGraspPool,
  defaultBranchHead: string,
  rootEventId: string,
  signal: AbortSignal,
  fallbackUrls: string[],
  tipCommitId?: string,
  stopAtCommitHash?: string,
): Promise<DetectedMergeCommit | null> {
  let offset = 0;
  let batchStart = defaultBranchHead;
  const maxTotal = stopAtCommitHash
    ? DETECTED_MERGE_HISTORY_MAX_WITH_BASE
    : DETECTED_MERGE_HISTORY_BATCH_SIZE;

  while (offset < maxTotal) {
    if (signal.aborted) return null;

    const remaining = maxTotal - offset;
    const batchSize = Math.min(DETECTED_MERGE_HISTORY_BATCH_SIZE, remaining);
    const batch = await gitPool.getCommitHistory(
      batchStart,
      batchSize,
      signal,
      fallbackUrls,
    );

    if (!batch || batch.length === 0 || signal.aborted) return null;

    const stopIdx = stopAtCommitHash
      ? batch.findIndex((commit) => commit.hash === stopAtCommitHash)
      : -1;
    const searchableBatch =
      stopIdx === -1 ? batch : batch.slice(0, stopIdx + 1);
    const detected = findDetectedNgitMergeCommit(
      searchableBatch,
      rootEventId,
      tipCommitId,
    );
    if (detected) return detected;

    if (!stopAtCommitHash || stopIdx !== -1) return null;

    offset += batch.length;

    const tail = batch[batch.length - 1];
    if (tail.parents.length === 0) return null;
    batchStart = tail.parents[0];
  }

  return null;
}

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

/**
 * Extract a hostname from common HTTP(S), SSH, and scp-style git remote URLs.
 */
function getGitRemoteHostname(cloneUrl: string): string | undefined {
  try {
    return new URL(cloneUrl).hostname;
  } catch {
    const sshMatch = cloneUrl.match(/^(?:[^@\s]+@)?([^:\s]+):/);
    if (sshMatch?.[1]) return sshMatch[1];

    const schemeMatch = cloneUrl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i);
    return schemeMatch?.[1];
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

function formatCloneUrlHost(cloneUrl: string): string {
  return getGitRemoteHostname(cloneUrl) ?? cloneUrl;
}

function summarizePushDelivery(summary: PushDeliverySummary): string {
  return `Pushed to ${summary.successCount}/${summary.totalCount} Grasp server${summary.totalCount !== 1 ? "s" : ""}.`;
}

async function serverRefMatches(
  cloneUrl: string,
  refUpdate: RefUpdate,
): Promise<boolean> {
  try {
    const refs = await getReceivePackRefs(cloneUrl);
    return refs.refs[refUpdate.refName] === refUpdate.newHash;
  } catch {
    return false;
  }
}

async function pushToGraspServer(
  cloneUrl: string,
  refUpdate: RefUpdate,
  packfile: Uint8Array,
): Promise<PushDeliveryOutcome> {
  if (await serverRefMatches(cloneUrl, refUpdate)) {
    return {
      cloneUrl,
      ok: true,
      message: "already has the new commit",
    };
  }

  try {
    const result = await pushToGitServer(cloneUrl, [refUpdate], packfile);
    const refFailures = result.refResults.filter((r) => !r.ok);

    if (result.unpackOk && refFailures.length === 0) {
      return {
        cloneUrl,
        ok: true,
        message: "accepted",
      };
    }

    if (await serverRefMatches(cloneUrl, refUpdate)) {
      return {
        cloneUrl,
        ok: true,
        message: "accepted; server reported a stale failure",
      };
    }

    if (!result.unpackOk) {
      return {
        cloneUrl,
        ok: false,
        message: "unpack failed",
      };
    }

    const failures = refFailures
      .map((r) => `${r.refName}: ${r.reason ?? "unknown"}`)
      .join("; ");

    return {
      cloneUrl,
      ok: false,
      message: failures || "ref update rejected",
    };
  } catch (err) {
    if (await serverRefMatches(cloneUrl, refUpdate)) {
      return {
        cloneUrl,
        ok: true,
        message: "accepted; confirmation failed",
      };
    }

    return {
      cloneUrl,
      ok: false,
      message: err instanceof Error ? err.message : "push failed",
    };
  }
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
  guessedBaseCommitId,
  prNevent,
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
  const [detectedMergeCommit, setDetectedMergeCommit] =
    useState<DetectedMergeCommit | null>(null);
  const [detectingMergeCommit, setDetectingMergeCommit] = useState(false);

  const supportsBrowserMerge = repo.graspCloneUrls.length > 0;
  const localMergeCommand = `ngit merge ${pr.rootEvent.id.slice(0, 8)} && git push`;
  const gitServerName = formatGitServerName(repo.additionalGitServerUrls);

  // Build the maintainer CommitPerson for the apply-to-tip path
  const maintainerCommitter: CommitPerson | undefined = useMemo(() => {
    if (!account) return undefined;
    const now = Math.floor(Date.now() / 1000);
    const tzOffset = new Date().getTimezoneOffset();
    const tzSign = tzOffset <= 0 ? "+" : "-";
    const tzHours = Math.floor(Math.abs(tzOffset) / 60)
      .toString()
      .padStart(2, "0");
    const tzMins = (Math.abs(tzOffset) % 60).toString().padStart(2, "0");
    return {
      name: profile?.displayName || profile?.name || "Anonymous",
      email: profile?.nip05 ?? `${nip19.npubEncode(account.pubkey)}@nostr`,
      timestamp: now,
      timezone: `${tzSign}${tzHours}${tzMins}`,
    };
  }, [account, profile]);

  const isPRType = pr.itemType === "pr";

  const patchTipCommitId = useMemo(() => {
    if (isPRType || !patchChain?.length) return undefined;
    return patchChain[patchChain.length - 1]?.commitId;
  }, [isPRType, patchChain]);

  const detectionTipCommitId = isPRType ? pr.tip.commitId : patchTipCommitId;
  const detectionStopCommitId = isPRType
    ? pr.tip.explicitMergeBase
    : patchChain?.[0]?.parentCommitId;

  useEffect(() => {
    setDetectedMergeCommit(null);

    if (
      !gitPool ||
      !defaultBranchHead ||
      mergeStep !== "idle" ||
      (pr.status !== "open" && pr.status !== "draft")
    ) {
      setDetectingMergeCommit(false);
      return;
    }

    const abort = new AbortController();
    setDetectingMergeCommit(true);

    findDetectedNgitMergeCommitInHistory(
      gitPool,
      defaultBranchHead,
      pr.rootEvent.id,
      abort.signal,
      effectiveCloneUrls,
      detectionTipCommitId,
      detectionStopCommitId,
    )
      .then((detected) => {
        if (abort.signal.aborted) return;
        setDetectedMergeCommit(detected);
      })
      .catch(() => {
        if (!abort.signal.aborted) setDetectedMergeCommit(null);
      })
      .finally(() => {
        if (!abort.signal.aborted) setDetectingMergeCommit(false);
      });

    return () => abort.abort();
  }, [
    gitPool,
    defaultBranchHead,
    effectiveCloneUrls,
    mergeStep,
    pr.rootEvent.id,
    pr.status,
    detectionTipCommitId,
    detectionStopCommitId,
  ]);

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

  const displayedStatus: MergePanelStatus = detectedMergeCommit
    ? "detected-merged"
    : mergeability.status;

  const defaultBranchRef = `refs/heads/${defaultBranchName}`;

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

  const publishMergedStatus = useCallback(
    async (mergeCommitHash: string): Promise<void> => {
      if (!account) return;

      const statusKind = STATUS_KIND_MAP["resolved"];
      const patchQuoteTags = (patchChain ?? []).map((patch) => [
        "q",
        patch.event.id,
        "",
        patch.pubkey,
      ]);

      const signedStatus = await StatusChangeFactory.create(
        statusKind,
        pr.rootEvent.id,
        pr.repoCoords,
        pr.pubkey,
        account.pubkey,
      )
        .modifyPublicTags((tags) => [
          ...tags,
          ["merge-commit", mergeCommitHash],
          ["r", mergeCommitHash],
          ...patchQuoteTags,
        ])
        .sign(account.signer);

      await outboxStore.publish(signedStatus, [
        `outbox:${account.pubkey}`,
        ...repo.allCoordinates,
        ...(pr.pubkey !== account.pubkey ? [`inbox:${pr.pubkey}`] : []),
      ]);
      eventStore.add(signedStatus);
    },
    [account, patchChain, pr, repo.allCoordinates],
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
      const message =
        err instanceof Error ? err.message : "Could not publish merged status";
      setMergeStep("failed");
      setMergeError(message);
      toast({
        title: "Could not mark as merged",
        description: message,
        variant: "destructive",
      });
    }
  }, [account, detectedMergeCommit, publishMergedStatus, toast]);

  // ── Push helper ──────────────────────────────────────────────────────────

  const pushObjects = useCallback(
    async (
      allObjects: PackableObject[],
      refUpdate: RefUpdate,
    ): Promise<PushDeliverySummary> => {
      // Safety guard at the single push choke point: never advance a branch to
      // a tip that does not descend from its current tip. A non-fast-forward
      // push orphans commits already on the branch — the disaster an incorrect
      // merge base can cause. Throw before sending anything to the git server.
      assertFastForwardSafe(allObjects, refUpdate.oldHash, refUpdate.newHash);

      const packfile = await createPackfile(allObjects);
      const outcomes = await Promise.all(
        repo.graspCloneUrls.map((cloneUrl) =>
          pushToGraspServer(cloneUrl, refUpdate, packfile),
        ),
      );
      const successCount = outcomes.filter((outcome) => outcome.ok).length;
      const summary: PushDeliverySummary = {
        outcomes,
        successCount,
        totalCount: outcomes.length,
      };

      if (successCount === 0) {
        const reasons = outcomes
          .map(
            (outcome) =>
              `${formatCloneUrlHost(outcome.cloneUrl)}: ${outcome.message}`,
          )
          .join("; ");
        throw new Error(
          `Push failed to all Grasp servers. ${reasons}. ` +
            "The state event will expire from purgatory in 30 minutes.",
        );
      }

      return summary;
    },
    [repo.graspCloneUrls],
  );

  // ── Merge orchestration (merge strategy) ─────────────────────────────────

  const handleMerge = useCallback(async () => {
    if (
      !account ||
      !mergeability.buildResult ||
      !defaultBranchHead ||
      !gitPool
    ) {
      return;
    }

    setMergeStep("building");
    setMergeError(null);
    setPushDelivery(null);

    try {
      let pushSummary: PushDeliverySummary | null = null;
      // ── Build the committer identity for the merge commit ──────────────
      const committerName =
        profile?.displayName || profile?.name || "Anonymous";
      const committerEmail =
        profile?.nip05 ?? `${nip19.npubEncode(account.pubkey)}@nostr`;

      const now = Math.floor(Date.now() / 1000);
      const tzOffset = new Date().getTimezoneOffset();
      const tzSign = tzOffset <= 0 ? "+" : "-";
      const tzHours = Math.floor(Math.abs(tzOffset) / 60)
        .toString()
        .padStart(2, "0");
      const tzMins = (Math.abs(tzOffset) % 60).toString().padStart(2, "0");
      const timezone = `${tzSign}${tzHours}${tzMins}`;

      const committer: CommitPerson = {
        name: committerName,
        email: committerEmail,
        timestamp: now,
        timezone,
      };

      const prNevent = nip19.neventEncode({
        id: pr.rootEvent.id,
        author: pr.pubkey,
        relays: repo.relays.slice(0, 3),
      });

      // Cover note takes precedence over the PR body in the merge commit
      // message (recorded under different headings — see buildMergeCommitMessage).
      const coverNote = pr.coverNote?.content || undefined;
      const prDescription = pr.body || undefined;

      const { mergeCommit } = await performMerge({
        signer: account.signer,
        signerPubkey: account.pubkey,
        chainObjects: mergeability.buildResult.objects,
        finalTreeHash: mergeability.buildResult.finalTreeHash,
        tipCommitHash: mergeability.buildResult.tipCommitHash,
        dTag: repo.dTag,
        defaultBranchName,
        defaultBranchHead,
        repoCoords: pr.repoCoords,
        rootEventId: pr.rootEvent.id,
        rootAuthorPubkey: pr.pubkey,
        subject: pr.currentSubject || pr.originalSubject,
        prNevent,
        rootAuthorName,
        coverNote,
        prDescription,
        committer,
        patchEventIds: (patchChain ?? []).map((patch) => ({
          id: patch.event.id,
          pubkey: patch.pubkey,
        })),
        publishStateToGrasp: (state) =>
          publishToGraspRelays(state, graspRelayUrls),
        pushObjects: async (objects, refUpdate) => {
          pushSummary = await pushObjects(objects, refUpdate);
          setPushDelivery(pushSummary);
          onSuccessfulPush?.();
        },
        publishStatusBroadly: (status) =>
          outboxStore.publish(status, [
            `outbox:${account.pubkey}`,
            ...repo.allCoordinates,
            ...(pr.pubkey !== account.pubkey ? [`inbox:${pr.pubkey}`] : []),
          ]),
        broadcastStateBroadly: (state) =>
          outboxStore.publish(state, [
            `outbox:${account.pubkey}`,
            ...repo.allCoordinates,
            "fallback-relays",
          ]),
        onEvent: (event) => eventStore.add(event),
        onStep: (step) => setMergeStep(step),
      });

      toast({
        title: "Patch merged",
        description: `Merge commit ${mergeCommit.hash.slice(0, 8)} pushed to ${defaultBranchName}. ${pushSummary ? summarizePushDelivery(pushSummary) : ""}`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Merge failed unexpectedly";
      setMergeStep("failed");
      setMergeError(message);
      toast({
        title: "Merge failed",
        description: message,
        variant: "destructive",
      });
    }
  }, [
    account,
    mergeability.buildResult,
    defaultBranchHead,
    defaultBranchName,
    gitPool,
    profile,
    pr,
    patchChain,
    pushObjects,
    repo,
    graspRelayUrls,
    toast,
    rootAuthorName,
    onSuccessfulPush,
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

    setMergeStep("building");
    setMergeError(null);
    setPushDelivery(null);

    try {
      const { objects, newTipCommitHash } = mergeability.applyResult;

      // Publish state event pointing to the new tip
      const signedState = await RepoStateFactory.create(
        repo.dTag,
        newTipCommitHash,
        defaultBranchName,
      ).sign(account.signer);

      setMergeStep("publishing-state");
      await publishToGraspRelays(signedState, graspRelayUrls);
      eventStore.add(signedState);

      // Push the linear commits
      setMergeStep("pushing");
      const pushSummary = await pushObjects(objects, {
        oldHash: defaultBranchHead,
        newHash: newTipCommitHash,
        refName: defaultBranchRef,
      });
      setPushDelivery(pushSummary);
      onSuccessfulPush?.();

      // Publish status + broadcast
      setMergeStep("publishing-status");

      const statusKind = STATUS_KIND_MAP["resolved"];
      const patchQuoteTags = (patchChain ?? []).map((patch) => [
        "q",
        patch.event.id,
        "",
        patch.pubkey,
      ]);

      const signedStatus = await StatusChangeFactory.create(
        statusKind,
        pr.rootEvent.id,
        pr.repoCoords,
        pr.pubkey,
        account.pubkey,
      )
        .modifyPublicTags((tags) => [
          ...tags,
          ["merge-commit", newTipCommitHash],
          ["r", newTipCommitHash],
          ...patchQuoteTags,
        ])
        .sign(account.signer);

      await outboxStore.publish(signedStatus, [
        `outbox:${account.pubkey}`,
        ...repo.allCoordinates,
        ...(pr.pubkey !== account.pubkey ? [`inbox:${pr.pubkey}`] : []),
      ]);
      eventStore.add(signedStatus);

      setMergeStep("broadcasting-state");
      await outboxStore.publish(signedState, [
        `outbox:${account.pubkey}`,
        ...repo.allCoordinates,
        "fallback-relays",
      ]);

      setMergeStep("done");
      const patchCount = patchChain?.length ?? 0;
      toast({
        title: "Patch applied",
        description: `${patchCount} commit${patchCount !== 1 ? "s" : ""} applied to ${defaultBranchName} (tip: ${newTipCommitHash.slice(0, 8)}). ${summarizePushDelivery(pushSummary)}`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Apply failed unexpectedly";
      setMergeStep("failed");
      setMergeError(message);
      toast({
        title: "Apply failed",
        description: message,
        variant: "destructive",
      });
    }
  }, [
    account,
    mergeability.applyResult,
    defaultBranchHead,
    defaultBranchName,
    defaultBranchRef,
    gitPool,
    pr,
    patchChain,
    pushObjects,
    repo,
    graspRelayUrls,
    toast,
    onSuccessfulPush,
  ]);

  // ── PR merge orchestration ────────────────────────────────────────────────

  const handlePRMerge = useCallback(async () => {
    if (!account || !prMergeability.result || !defaultBranchHead) {
      return;
    }

    setMergeStep("building");
    setMergeError(null);
    setPushDelivery(null);

    try {
      const { mergeCommitObj } = prMergeability.result;

      // ── Step 2+3: Publish state + push ────────────────────────────────
      const signedState = await RepoStateFactory.create(
        repo.dTag,
        mergeCommitObj.hash,
        defaultBranchName,
      ).sign(account.signer);

      setMergeStep("publishing-state");
      await publishToGraspRelays(signedState, graspRelayUrls);
      eventStore.add(signedState);

      setMergeStep("pushing");
      // Push the merge commit PLUS any new objects a three-way merge produced
      // (rebuilt trees + auto-merged blobs). For the fast path extraObjects is
      // empty and the PR tip's tree already exists on the server.
      const pushSummary = await pushObjects(
        [mergeCommitObj, ...prMergeability.result.extraObjects],
        {
          oldHash: defaultBranchHead,
          newHash: mergeCommitObj.hash,
          refName: defaultBranchRef,
        },
      );
      setPushDelivery(pushSummary);
      onSuccessfulPush?.();

      // ── Step 4+5: Status + broadcast ──────────────────────────────────
      setMergeStep("publishing-status");

      const statusKind = STATUS_KIND_MAP["resolved"];
      const signedStatus = await StatusChangeFactory.create(
        statusKind,
        pr.rootEvent.id,
        pr.repoCoords,
        pr.pubkey,
        account.pubkey,
      )
        .modifyPublicTags((tags) => [
          ...tags,
          ["merge-commit", mergeCommitObj.hash],
          ["r", mergeCommitObj.hash],
        ])
        .sign(account.signer);

      await outboxStore.publish(signedStatus, [
        `outbox:${account.pubkey}`,
        ...repo.allCoordinates,
        ...(pr.pubkey !== account.pubkey ? [`inbox:${pr.pubkey}`] : []),
      ]);
      eventStore.add(signedStatus);

      setMergeStep("broadcasting-state");
      await outboxStore.publish(signedState, [
        `outbox:${account.pubkey}`,
        ...repo.allCoordinates,
        "fallback-relays",
      ]);

      setMergeStep("done");
      toast({
        title: "PR merged",
        description: `Merge commit ${mergeCommitObj.hash.slice(0, 8)} pushed to ${defaultBranchName}. ${summarizePushDelivery(pushSummary)}`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Merge failed unexpectedly";
      setMergeStep("failed");
      setMergeError(message);
      toast({
        title: "Merge failed",
        description: message,
        variant: "destructive",
      });
    }
  }, [
    account,
    prMergeability.result,
    defaultBranchHead,
    defaultBranchName,
    defaultBranchRef,
    pr,
    pushObjects,
    repo,
    graspRelayUrls,
    toast,
    onSuccessfulPush,
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
                {mergeability.status === "loading" && (
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
            {!detectedMergeCommit && mergeability.mergeBaseMismatch && (
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
                      history. The PR author's tooling likely miscalculated it —
                      treat the PR's metadata with caution.
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
                  This repository uses {gitServerName}, so merging directly from
                  gitworkshop isn't supported. To merge, run this from your
                  local repo:
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
