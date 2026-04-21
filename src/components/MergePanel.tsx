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

import { useState, useCallback, useMemo } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import {
  GitMerge,
  GitBranch,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useMyProfile } from "@/hooks/useProfile";
import {
  usePatchMergeability,
  type MergeabilityStatus,
} from "@/hooks/usePatchMergeability";
import {
  usePRMergeability,
  type PRMergeabilityStatus,
} from "@/hooks/usePRMergeability";
import { createMergeCommitObject } from "@/lib/patch-merge";
import { createPackfile, type PackableObject } from "@/lib/git-packfile";
import { pushToGitServer, type RefUpdate } from "@/lib/git-push";
import { pool as relayPool, eventStore } from "@/services/nostr";
import { factory } from "@/services/actions";
import { outboxStore } from "@/services/outbox";

import { RepoStateBlueprint } from "@/blueprints/repo";
import { StatusChangeBlueprint, STATUS_KIND_MAP } from "@/blueprints/status";
import type { CommitPerson } from "@/lib/git-objects";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
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
}: MergePanelProps) {
  const account = useActiveAccount();
  const profile = useMyProfile();
  const { toast } = useToast();

  // Merge step tracking
  const [mergeStep, setMergeStep] = useState<MergeStep>("idle");
  const [mergeError, setMergeError] = useState<string | null>(null);

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
  const prDescription = pr.coverNote?.content || pr.body || undefined;
  const prMergeability = usePRMergeability(
    isPRType ? pr.tip.commitId : undefined,
    defaultBranchHead,
    maintainerCommitter,
    pr.currentSubject || pr.originalSubject,
    prNevent ?? "",
    prDescription,
    gitPool,
    effectiveCloneUrls,
    isPRType,
  );

  // Unified mergeability view for the render logic
  const mergeability = isPRType
    ? {
        status: prMergeability.status as
          | MergeabilityStatus
          | PRMergeabilityStatus,
        buildResult: null,
        applyResult: null,
        conflicts: [] as import("@/lib/patch-merge").MergeConflict[],
        errorMessage: prMergeability.errorMessage,
        mergeStrategyError: null,
        recheck: prMergeability.recheck,
      }
    : {
        ...patchMergeability,
        status: patchMergeability.status as
          | MergeabilityStatus
          | PRMergeabilityStatus,
      };

  const defaultBranchRef = `refs/heads/${defaultBranchName}`;

  // Grasp relay URLs: repo relays whose hostname matches a Grasp server domain
  const graspRelayUrls = useMemo(
    () => repo.relays.filter((r) => isGraspRelay(r, repo.graspServerDomains)),
    [repo.relays, repo.graspServerDomains],
  );

  // Can we show the merge button?
  const canMerge =
    mergeability.status === "ready" &&
    defaultBranchHead &&
    mergeStep === "idle";

  // Can we show the apply-to-tip button? (patch-type only)
  const canApplyToTip =
    !isPRType &&
    mergeability.status === "ready-apply-only" &&
    defaultBranchHead &&
    mergeStep === "idle";

  // ── Push helper ──────────────────────────────────────────────────────────

  const pushObjects = useCallback(
    async (
      allObjects: PackableObject[],
      refUpdate: RefUpdate,
    ): Promise<void> => {
      const packfile = await createPackfile(allObjects);
      let pushSucceeded = false;
      let lastPushError = "";

      for (const cloneUrl of repo.graspCloneUrls) {
        try {
          const result = await pushToGitServer(cloneUrl, [refUpdate], packfile);
          if (result.unpackOk) {
            const refOk = result.refResults.every((r) => r.ok);
            if (refOk) {
              pushSucceeded = true;
              break;
            } else {
              const failures = result.refResults
                .filter((r) => !r.ok)
                .map((r) => `${r.refName}: ${r.reason ?? "unknown"}`)
                .join("; ");
              lastPushError = `Ref update rejected: ${failures}`;
            }
          } else {
            lastPushError = `Unpack failed on ${cloneUrl}`;
          }
        } catch (err) {
          lastPushError =
            err instanceof Error ? err.message : `Push failed to ${cloneUrl}`;
        }
      }

      if (!pushSucceeded) {
        throw new Error(
          `Push failed to all Grasp servers. ${lastPushError}. ` +
            "The state event will expire from purgatory in 30 minutes.",
        );
      }
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

    try {
      // ── Step 1: Build merge commit ────────────────────────────────────
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

      // Use the latest cover note body if present, otherwise fall back to the
      // original PR body.
      const prDescription = pr.coverNote?.content || pr.body || undefined;

      const mergeCommitObj = await createMergeCommitObject(
        mergeability.buildResult.finalTreeHash,
        defaultBranchHead,
        mergeability.buildResult.tipCommitHash,
        committer,
        pr.currentSubject || pr.originalSubject,
        pr.itemType,
        prNevent,
        prDescription,
      );

      const allObjects: PackableObject[] = [
        ...mergeability.buildResult.objects,
        mergeCommitObj,
      ];

      // ── Step 2+3: Publish state + push ────────────────────────────────
      const stateTemplate = await factory.create(
        RepoStateBlueprint,
        repo.dTag,
        mergeCommitObj.hash,
        defaultBranchName,
      );

      const signedState = await account.signer.signEvent(
        stateTemplate as EventTemplate,
      );

      setMergeStep("publishing-state");
      await publishToGraspRelays(signedState, graspRelayUrls);
      eventStore.add(signedState);

      setMergeStep("pushing");
      await pushObjects(allObjects, {
        oldHash: defaultBranchHead,
        newHash: mergeCommitObj.hash,
        refName: defaultBranchRef,
      });

      // ── Step 4+5: Status + broadcast ──────────────────────────────────
      setMergeStep("publishing-status");

      const statusKind = STATUS_KIND_MAP["resolved"];
      const statusDraft = await factory.create(
        StatusChangeBlueprint,
        statusKind,
        pr.rootEvent.id,
        pr.repoCoords,
        pr.pubkey,
        account.pubkey,
      );

      const statusTags = [
        ...(statusDraft.tags ?? []),
        ["merge-commit", mergeCommitObj.hash],
        ["r", mergeCommitObj.hash],
      ];

      for (const patch of patchChain ?? []) {
        statusTags.push(["q", patch.event.id, "", patch.pubkey]);
      }

      const statusTemplate: EventTemplate = {
        ...statusDraft,
        tags: statusTags,
      };

      const signedStatus = await account.signer.signEvent(statusTemplate);

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
        title: "Patch merged",
        description: `Merge commit ${mergeCommitObj.hash.slice(0, 8)} pushed to ${defaultBranchName}.`,
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
    defaultBranchRef,
    gitPool,
    profile,
    pr,
    patchChain,
    pushObjects,
    repo,
    graspRelayUrls,
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

    setMergeStep("building");
    setMergeError(null);

    try {
      const { objects, newTipCommitHash } = mergeability.applyResult;

      // Publish state event pointing to the new tip
      const stateTemplate = await factory.create(
        RepoStateBlueprint,
        repo.dTag,
        newTipCommitHash,
        defaultBranchName,
      );

      const signedState = await account.signer.signEvent(
        stateTemplate as EventTemplate,
      );

      setMergeStep("publishing-state");
      await publishToGraspRelays(signedState, graspRelayUrls);
      eventStore.add(signedState);

      // Push the linear commits
      setMergeStep("pushing");
      await pushObjects(objects, {
        oldHash: defaultBranchHead,
        newHash: newTipCommitHash,
        refName: defaultBranchRef,
      });

      // Publish status + broadcast
      setMergeStep("publishing-status");

      const statusKind = STATUS_KIND_MAP["resolved"];
      const statusDraft = await factory.create(
        StatusChangeBlueprint,
        statusKind,
        pr.rootEvent.id,
        pr.repoCoords,
        pr.pubkey,
        account.pubkey,
      );

      const statusTags = [
        ...(statusDraft.tags ?? []),
        ["merge-commit", newTipCommitHash],
        ["r", newTipCommitHash],
      ];

      for (const patch of patchChain ?? []) {
        statusTags.push(["q", patch.event.id, "", patch.pubkey]);
      }

      const statusTemplate: EventTemplate = {
        ...statusDraft,
        tags: statusTags,
      };

      const signedStatus = await account.signer.signEvent(statusTemplate);

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
        description: `${patchCount} commit${patchCount !== 1 ? "s" : ""} applied to ${defaultBranchName} (tip: ${newTipCommitHash.slice(0, 8)}).`,
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
  ]);

  // ── PR merge orchestration ────────────────────────────────────────────────

  const handlePRMerge = useCallback(async () => {
    if (!account || !prMergeability.result || !defaultBranchHead) {
      return;
    }

    setMergeStep("building");
    setMergeError(null);

    try {
      const { mergeCommitObj } = prMergeability.result;

      // ── Step 2+3: Publish state + push ────────────────────────────────
      const stateTemplate = await factory.create(
        RepoStateBlueprint,
        repo.dTag,
        mergeCommitObj.hash,
        defaultBranchName,
      );

      const signedState = await account.signer.signEvent(
        stateTemplate as EventTemplate,
      );

      setMergeStep("publishing-state");
      await publishToGraspRelays(signedState, graspRelayUrls);
      eventStore.add(signedState);

      setMergeStep("pushing");
      await pushObjects([mergeCommitObj], {
        oldHash: defaultBranchHead,
        newHash: mergeCommitObj.hash,
        refName: defaultBranchRef,
      });

      // ── Step 4+5: Status + broadcast ──────────────────────────────────
      setMergeStep("publishing-status");

      const statusKind = STATUS_KIND_MAP["resolved"];
      const statusDraft = await factory.create(
        StatusChangeBlueprint,
        statusKind,
        pr.rootEvent.id,
        pr.repoCoords,
        pr.pubkey,
        account.pubkey,
      );

      const statusTags = [
        ...(statusDraft.tags ?? []),
        ["merge-commit", mergeCommitObj.hash],
        ["r", mergeCommitObj.hash],
      ];

      const statusTemplate: EventTemplate = {
        ...statusDraft,
        tags: statusTags,
      };

      const signedStatus = await account.signer.signEvent(statusTemplate);

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
        description: `Merge commit ${mergeCommitObj.hash.slice(0, 8)} pushed to ${defaultBranchName}.`,
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
  ]);

  // ── Render ──────────────────────────────────────────────────────────────

  const isMerging =
    mergeStep !== "idle" && mergeStep !== "done" && mergeStep !== "failed";

  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <StatusIcon status={mergeability.status} mergeStep={mergeStep} />
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            {/* Status headline */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <StatusHeadline
                  status={mergeability.status}
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
                      mergeability.recheck();
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Recheck
                  </Button>
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

function StatusIcon({
  status,
  mergeStep,
}: {
  status: MergeabilityStatus | PRMergeabilityStatus;
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
  status: MergeabilityStatus | PRMergeabilityStatus;
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
