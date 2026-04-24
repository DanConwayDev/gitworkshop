/**
 * RepoSettingsPage — repository settings for maintainers.
 *
 * Currently provides:
 *   - Default branch: updates the HEAD pointer in the kind:30618 state event.
 *
 * Only accessible when the logged-in user is a confirmed maintainer of the
 * repository.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import {
  AlertTriangle,
  GitBranch,
  Loader2,
  Check,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

import { useRepoContext } from "./RepoContext";
import { REPO_STATE_KIND } from "@/lib/nip34";
import { repoToPath } from "@/lib/routeUtils";
import { publish } from "@/services/nostr";
import type { EventTemplate } from "nostr-tools";

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RepoSettingsPage() {
  const { resolved, nip05, repoState } = useRepoContext();
  const account = useActiveAccount();
  const repo = resolved?.repo;

  const isMaintainer =
    account?.pubkey && repo && repo.maintainerSet.includes(account.pubkey);

  const basePath = repo
    ? repoToPath(repo.selectedMaintainer, repo.dTag, repo.relays, nip05)
    : undefined;

  if (!repo || !basePath) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      </div>
    );
  }

  if (!isMaintainer) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        <div className="max-w-md">
          <div className="flex items-center gap-2 text-destructive mb-4">
            <AlertTriangle className="h-5 w-5" />
            <p className="font-medium">Not authorised</p>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Only confirmed maintainers can access repository settings.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to={basePath}>Back to repository</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <RepoSettingsForm
      repo={repo}
      repoState={repoState ?? null}
      accountSigner={account.signer}
    />
  );
}

// ---------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------

import type { ResolvedRepo } from "@/lib/nip34";
import type { RepositoryState } from "@/casts/RepositoryState";

interface RepoSettingsFormProps {
  repo: ResolvedRepo;
  repoState: RepositoryState | null;
  accountSigner: {
    signEvent: (
      template: EventTemplate,
    ) => Promise<import("nostr-tools").NostrEvent>;
  };
}

function RepoSettingsForm({
  repo,
  repoState,
  accountSigner,
}: RepoSettingsFormProps) {
  // Derive branch list from the state event refs
  const branches = useMemo(() => {
    if (!repoState) return [];
    return repoState.refs
      .filter((r) => r.name.startsWith("refs/heads/"))
      .map((r) => r.name.replace("refs/heads/", ""))
      .sort();
  }, [repoState]);

  const currentHeadBranch = repoState?.headBranch ?? null;

  // selectedBranch tracks what the user has picked in the dropdown.
  // We initialise to "" and sync once repoState arrives (useState initialiser
  // only runs on first render, so async data must be synced via useEffect).
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [userHasSelected, setUserHasSelected] = useState(false);

  // Once we have the branch list / HEAD, seed the selection — but only if the
  // user hasn't already interacted with the dropdown.
  useEffect(() => {
    if (userHasSelected) return;
    const seed = currentHeadBranch ?? branches[0] ?? "";
    setSelectedBranch(seed);
  }, [currentHeadBranch, branches, userHasSelected]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Only dirty when the user has actively chosen a branch different from the
  // current HEAD (or chosen any branch when there is no HEAD yet).
  const isDirty = userHasSelected && selectedBranch !== currentHeadBranch;
  const canSave = isDirty && selectedBranch.length > 0 && !isSaving;

  const handleSave = useCallback(async () => {
    if (!canSave || !repoState) return;

    setIsSaving(true);
    setSaveError(undefined);
    setSaveSuccess(false);

    try {
      // Rebuild the state event tags, replacing the HEAD tag.
      // Preserve all existing ref tags and any other tags verbatim.
      const existingTags = repoState.event.tags;

      // Replace or add the HEAD tag
      const newHeadValue = `ref: refs/heads/${selectedBranch}`;
      const hasHead = existingTags.some(([t]) => t === "HEAD");

      const newTags: string[][] = hasHead
        ? existingTags.map((tag) =>
            tag[0] === "HEAD" ? ["HEAD", newHeadValue] : tag,
          )
        : [...existingTags, ["HEAD", newHeadValue]];

      const template: EventTemplate = {
        kind: REPO_STATE_KIND,
        content: repoState.event.content,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
      };

      const signedEvent = await accountSigner.signEvent(template);

      // Publish to user outbox + repo's declared relays
      const repoCoord = `30617:${repo.selectedMaintainer}:${repo.dTag}`;
      await publish(signedEvent, [repoCoord]);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save settings",
      );
    } finally {
      setIsSaving(false);
    }
  }, [canSave, repoState, selectedBranch, accountSigner, repo]);

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold mb-6">Repository settings</h1>

        <div className="space-y-8">
          {/* ── Default branch ─────────────────────────────────────────── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Default branch</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                The default branch is used as the HEAD of the repository. It is
                shown first in the code view and used as the base for pull
                requests. Changing this updates the{" "}
                <code className="font-mono">HEAD</code> pointer in the
                kind:30618 Nostr state event.
              </p>
            </div>

            {!repoState ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>
                    No state event found for this repository. Push your
                    repository via <code className="font-mono">ngit push</code>{" "}
                    to create one, then return here to set the default branch.
                  </p>
                </div>
              </div>
            ) : branches.length === 0 ? (
              <div className="rounded-lg border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                No branches found in the repository state event.
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        id="default-branch"
                        variant="outline"
                        className="w-full max-w-xs justify-between font-mono text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {selectedBranch || "Select branch…"}
                        </span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px]">
                      {branches.map((branch) => (
                        <DropdownMenuItem
                          key={branch}
                          onSelect={() => {
                            setSelectedBranch(branch);
                            setUserHasSelected(branch !== currentHeadBranch);
                          }}
                          className="flex items-center justify-between font-mono text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {branch}
                          </span>
                          {branch === currentHeadBranch && (
                            <span className="text-xs text-muted-foreground ml-2">
                              current
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {currentHeadBranch && (
                  <p className="text-xs text-muted-foreground">
                    Current default branch:{" "}
                    <code className="font-mono bg-muted px-1 py-0.5 rounded">
                      {currentHeadBranch}
                    </code>
                  </p>
                )}
              </div>
            )}
          </section>

          <Separator />

          {/* ── Error / success / actions ───────────────────────────────── */}
          {saveError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {saveError}
                </p>
              </div>
            </div>
          )}

          {repoState && branches.length > 0 && (
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleSave()}
                disabled={!canSave}
                className="bg-pink-600 hover:bg-pink-700 text-white"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Saved
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
              {isDirty && !isSaving && !saveSuccess && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelectedBranch(currentHeadBranch ?? branches[0] ?? "");
                    setUserHasSelected(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
