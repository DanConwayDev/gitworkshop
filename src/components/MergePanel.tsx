/**
 * MergePanel — merge button and status panel for patch-type PRs on Grasp repos.
 *
 * Shown at the bottom of the conversation tab, above the reply box. Eagerly
 * checks whether the patch chain applies cleanly and shows one of:
 *   - "Ready to merge" with a green merge button
 *   - "Conflicts detected" with file-level details
 *   - "Error" with a human-readable message
 *
 * The merge orchestration sequence:
 *   1. Build merge commit (pure computation, sub-millisecond)
 *   2. Publish kind:30618 state event to Grasp relays ONLY (purgatory)
 *   3. Push packfile to Grasp git server(s)
 *   4. Publish kind:1631 merged status event to all relay groups
 *   5. Publish kind:30618 to remaining relays (user outbox, repo relays)
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
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
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
import { createMergeCommitObject } from "@/lib/patch-merge";
import { createPackfile, type PackableObject } from "@/lib/git-packfile";
import { pushToGitServer, type RefUpdate } from "@/lib/git-push";
import { pool as relayPool, eventStore } from "@/services/nostr";
import { factory } from "@/services/actions";
import { outboxStore } from "@/services/outbox";
import { gitIndexRelays, extraRelays } from "@/services/settings";
import { RepoStateBlueprint } from "@/blueprints/repo";
import { StatusChangeBlueprint, STATUS_KIND_MAP } from "@/blueprints/status";
import type { CommitPerson } from "@/lib/git-objects";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import { repoCoordinate } from "@/lib/nip34";
import type { ResolvedPR, ResolvedRepo } from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MergePanelProps {
  /** The resolved PR (must be itemType === "patch") */
  pr: ResolvedPR;
  /** The resolved repository */
  repo: ResolvedRepo;
  /** The patch chain (cover letters excluded) */
  patchChain: Patch[];
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
  done: "Merge complete!",
  failed: "Merge failed",
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
}: MergePanelProps) {
  const account = useActiveAccount();
  const profile = useMyProfile();
  const { toast } = useToast();

  // Merge step tracking
  const [mergeStep, setMergeStep] = useState<MergeStep>("idle");
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Eagerly check mergeability
  const mergeability = usePatchMergeability(
    patchChain,
    gitPool,
    effectiveCloneUrls,
    true,
  );

  const defaultBranchRef = `refs/heads/${defaultBranchName}`;

  // Grasp relay URLs: repo relays whose hostname matches a Grasp server domain
  const graspRelayUrls = useMemo(
    () => repo.relays.filter((r) => isGraspRelay(r, repo.graspServerDomains)),
    [repo.relays, repo.graspServerDomains],
  );

  // Non-Grasp relay URLs (for broadcasting after successful push)
  const nonGraspRelayUrls = useMemo(
    () => repo.relays.filter((r) => !isGraspRelay(r, repo.graspServerDomains)),
    [repo.relays, repo.graspServerDomains],
  );

  // Can we show the merge button at all?
  const canMerge =
    mergeability.status === "ready" &&
    defaultBranchHead &&
    mergeStep === "idle";

  // The merge orchestration
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
        profile?.nip05 ??
        `${nip19.npubEncode(account.pubkey).slice(0, 16)}@nostr`;

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

      // Get the patch author's name for the merge message
      const patchAuthorNpub = nip19.npubEncode(pr.pubkey);
      const authorDisplayName = patchAuthorNpub.slice(0, 16) + "...";

      const mergeCommitObj = await createMergeCommitObject(
        mergeability.buildResult.finalTreeHash,
        defaultBranchHead,
        mergeability.buildResult.tipCommitHash,
        committer,
        pr.currentSubject || pr.originalSubject,
        authorDisplayName,
      );

      // Combine all objects: patch chain objects + merge commit
      const allObjects: PackableObject[] = [
        ...mergeability.buildResult.objects,
        mergeCommitObj,
      ];

      // ── Step 2: Publish state event to Grasp relays (purgatory) ───────
      setMergeStep("publishing-state");

      const stateTemplate = await factory.create(
        RepoStateBlueprint,
        repo.dTag,
        mergeCommitObj.hash,
        defaultBranchName,
      );
      const signedState = await account.signer.signEvent(
        stateTemplate as EventTemplate,
      );

      await publishToGraspRelays(signedState, graspRelayUrls);

      // Add to local store for immediate UI update
      eventStore.add(signedState);

      // ── Step 3: Push packfile to Grasp git server(s) ──────────────────
      setMergeStep("pushing");

      const packfile = await createPackfile(allObjects);
      const refUpdate: RefUpdate = {
        oldHash: defaultBranchHead,
        newHash: mergeCommitObj.hash,
        refName: defaultBranchRef,
      };

      // Try each Grasp clone URL until one succeeds
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

      // ── Step 4: Publish kind:1631 merged status event ─────────────────
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

      // Add merge-specific tags to the status event
      const statusTags = [
        ...(statusDraft.tags ?? []),
        ["merge-commit", mergeCommitObj.hash],
        ["r", mergeCommitObj.hash],
      ];

      // Add q tags for each patch event in the chain
      for (const patch of patchChain) {
        statusTags.push(["q", patch.event.id, "", patch.pubkey]);
      }

      const statusTemplate: EventTemplate = {
        ...statusDraft,
        tags: statusTags,
      };

      const signedStatus = await account.signer.signEvent(statusTemplate);

      // Publish to all relay groups (user outbox + repo relays + git index + notifications)
      const indexRelays = gitIndexRelays.getValue();
      const relayGroups: Record<string, string[]> = {};

      const repoCoord = repoCoordinate(repo.selectedMaintainer, repo.dTag);
      if (indexRelays.length > 0) {
        relayGroups["git index"] = indexRelays;
      }
      if (repo.relays.length > 0) {
        relayGroups[repoCoord] = repo.relays;
      }

      await outboxStore.publish(signedStatus, relayGroups);
      eventStore.add(signedStatus);

      // ── Step 5: Broadcast state event to remaining relays ─────────────
      setMergeStep("broadcasting-state");

      const broadcastGroups: Record<string, string[]> = {};
      if (nonGraspRelayUrls.length > 0) {
        broadcastGroups[repoCoord] = nonGraspRelayUrls;
      }
      if (indexRelays.length > 0) {
        broadcastGroups["git index"] = indexRelays;
      }
      const userExtraRelays = extraRelays.getValue();
      if (userExtraRelays.length > 0) {
        broadcastGroups["extra relays"] = userExtraRelays;
      }

      if (Object.keys(broadcastGroups).length > 0) {
        await outboxStore.publish(signedState, broadcastGroups);
      }

      // ── Done ──────────────────────────────────────────────────────────
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
    repo,
    graspRelayUrls,
    nonGraspRelayUrls,
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
                    mergeability.buildResult?.allHashesVerified ?? false
                  }
                />
              </div>

              {/* Merge button / recheck */}
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
                        <AlertDialogTitle>Merge this patch?</AlertDialogTitle>
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
                              ahead of the patch base, but the patches apply
                              cleanly.
                            </>
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleMerge}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                          Confirm merge
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
                    <span className="text-xs font-medium">Merged</span>
                  </div>
                )}
              </div>
            </div>

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
  status: MergeabilityStatus;
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
}: {
  status: MergeabilityStatus;
  mergeStep: MergeStep;
  mergeError: string | null;
  defaultBranchName: string;
  behindCount: number | undefined;
  allHashesVerified: boolean;
}) {
  if (mergeStep === "done") {
    return (
      <p className="text-sm font-medium text-green-600">
        Patch merged into{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {defaultBranchName}
        </code>
      </p>
    );
  }

  if (mergeStep === "failed") {
    return <p className="text-sm font-medium text-destructive">Merge failed</p>;
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
          Checking if this patch can be merged into{" "}
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
            No merge conflicts with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              {defaultBranchName}
            </code>
          </p>
          {behindCount !== undefined && behindCount > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">
              Default branch is {behindCount} commit
              {behindCount !== 1 ? "s" : ""} ahead of the patch base, but
              patches apply cleanly.
            </p>
          )}
          {!allHashesVerified && (
            <p className="text-xs text-amber-600 mt-0.5">
              Diffs applied correctly. Tooling produced commit ID mismatch but
              for cosmetic reasons only (GPG signatures, whitespace, timezone
              encoding).
            </p>
          )}
        </div>
      );
    case "conflicts":
      return (
        <p className="text-sm font-medium text-destructive">
          This patch has merge conflicts with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            {defaultBranchName}
          </code>
        </p>
      );
    case "error":
      return (
        <p className="text-sm text-amber-600">
          Could not determine mergeability
          {mergeError ? `: ${mergeError}` : ""}
        </p>
      );
    default:
      return (
        <p className="text-sm text-muted-foreground">
          Merge status unavailable
        </p>
      );
  }
}
