import { useCallback, useEffect, useMemo, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { Link } from "react-router-dom";
import { repoToPath } from "@/lib/routeUtils";
import { useSeoMeta } from "@unhead/react";
import { useProfile } from "@/hooks/useProfile";
import { useActiveAccount } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import { EditableSubject } from "@/components/EditSubjectInline";
import {
  EventBodyCard,
  CoverNoteCard,
  SubjectRenameCard,
  StatusChangeCard,
  LabelChangeCard,
} from "@/components/EventThreadComponents";
import { ThreadTree } from "@/components/ThreadTree";
import { EventSearchStatus } from "@/components/EventSearchStatus";
import { useResolvedIssue } from "@/hooks/useResolvedIssue";
import type { RelayGroupSpec } from "@/hooks/useEventSearch";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { UserAvatar, UserLink } from "@/components/UserAvatar";
import { StatusDropdownBadge } from "@/components/StatusDropdownBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { ManageLabels, type LabelEventEntry } from "@/components/ManageLabels";
import { ReplyBox } from "@/components/ReplyBox";
import { CoverNoteBox } from "@/components/CoverNoteBox";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { gitIndexRelays, fallbackRelays } from "@/services/settings";
import { ArrowLeft, MessageCircle, Zap, Users, Clock, Pin } from "lucide-react";

export default function IssuePage() {
  const { pubkey, repoId, resolved, issueId, nip05 } = useRepoContext();
  const repo = resolved?.repo;
  const repoOwnerProfile = useProfile(pubkey);

  // All confirmed co-maintainer coordinates — gives the full union of relay
  // groups for publishing. Falls back to the issue's own `a` tag coords if
  // the resolved repo isn't available yet (shouldn't happen in practice).
  // Using allCoordinates instead of issue.repoCoords ensures comments, status
  // changes, labels etc. reach every co-maintainer's relay set, not just the
  // single maintainer baked into the issue's `a` tag at creation time.
  const repoAllCoords = repo?.allCoordinates;

  // Compute the effective maintainer set.
  const selectedMaintainers = useMemo(
    () => (repo?.maintainerSet ? new Set(repo.maintainerSet) : undefined),
    [repo?.maintainerSet],
  );

  // ── Retry search ─────────────────────────────────────────────────────────
  const [retryKey, setRetryKey] = useState(0);
  const handleRetry = useCallback(() => setRetryKey((k) => k + 1), []);

  // ── "Search more relays" expansion (curated mode) ────────────────────────
  const [searchMoreActive, setSearchMoreActive] = useState(false);

  const extraSearchGroups = useMemo<RelayGroupSpec[]>(() => {
    if (!searchMoreActive) return [];
    return [
      { label: "git index", relays$: gitIndexRelays },
      { label: "fallback relays", relays$: fallbackRelays },
    ];
  }, [searchMoreActive]);

  const handleSearchMore = useCallback(() => {
    setSearchMoreActive(true);
  }, []);

  // ── Unified issue resolution ─────────────────────────────────────────────
  const { issue, search } = useResolvedIssue(
    issueId,
    resolved?.repoRelayGroup,
    resolved?.extraRelaysForMaintainerMailboxCoverage,
    selectedMaintainers,
    extraSearchGroups,
    retryKey,
  );

  // Ordered priority pubkeys for @ mention autocomplete:
  // parent author first, then participants, then maintainers (deduped).
  const mentionPriorityPubkeys = useMemo<string[]>(() => {
    if (!issue) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (pk: string) => {
      if (!seen.has(pk)) {
        seen.add(pk);
        out.push(pk);
      }
    };
    add(issue.pubkey);
    for (const pk of issue.participants) add(pk);
    for (const pk of repo?.maintainerSet ?? []) add(pk);
    return out;
  }, [issue, repo?.maintainerSet]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const activeAccount = useActiveAccount();
  const canEdit = useMemo(() => {
    if (!activeAccount || !issue) return false;
    return issue.authorisedUsers.has(activeAccount.pubkey);
  }, [activeAccount, issue]);

  // ── Label event map — maps each deletable label to its source event ─────────
  // Labels from the root event's t-tags are excluded (can't be deleted via
  // a label event). If the same label exists as both a t-tag and a label event,
  // it stays non-deletable (deleting the event wouldn't remove the t-tag label).
  const labelEventMap = useMemo<Map<string, LabelEventEntry>>(() => {
    if (!issue) return new Map();
    const tTagLabels = new Set<string>(
      (issue.rootEvent as NostrEvent).tags
        .filter(([t, v]) => t === "t" && v)
        .map(([, v]) => v as string),
    );
    const map = new Map<string, LabelEventEntry>();
    for (const node of issue.timelineNodes) {
      if (node.type !== "label" || !node.authorised) continue;
      for (const label of node.labels) {
        if (!tTagLabels.has(label) && !map.has(label)) {
          map.set(label, { event: node.event, eventLabels: node.labels });
        }
      }
    }
    return map;
  }, [issue]);

  // ── Cover note editor state ───────────────────────────────────────────────
  const [coverNoteEditing, setCoverNoteEditing] = useState(false);

  useSeoMeta({
    title: issue
      ? `${issue.currentSubject || issue.originalSubject} - ngit`
      : "Issue - ngit",
    description: issue?.body.slice(0, 160) ?? "Loading issue...",
    ogImage: repoOwnerProfile?.picture ?? "/og-image.svg",
    ogImageAlt: repo?.name ?? repoId,
    twitterCard: repoOwnerProfile?.picture ? "summary" : "summary_large_image",
  });

  // ── Not-found / searching / deleted / vanished state ─────────────────────
  // Show skeleton first, then reveal the relay-status page after a short
  // delay. The timer starts as soon as the search begins and is never reset
  // by transient gaps (e.g. relay group changes mid-search). It only resets
  // when the item ID changes (new navigation).
  const [searchDelayElapsed, setSearchDelayElapsed] = useState(false);
  useEffect(() => {
    setSearchDelayElapsed(false);
    const timer = setTimeout(() => setSearchDelayElapsed(true), 1500);
    return () => clearTimeout(timer);
  }, [issueId]);

  const showSearchStatus =
    !issue && search && searchDelayElapsed && !search.found;

  if (showSearchStatus) {
    const repoBasePath = repoToPath(
      pubkey,
      repoId,
      resolved?.repo?.relays ?? [],
      nip05,
    );
    return (
      <EventSearchStatus
        search={search}
        eventId={issueId}
        itemLabel="Issue"
        backPath={`${repoBasePath}/issues`}
        backLabel="Back to issues"
        onSearchMore={
          !searchMoreActive && search.settled ? handleSearchMore : undefined
        }
        searchMoreActive={searchMoreActive}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <>
      {/* Issue header */}
      <div className="border-b border-border/40">
        <div className="container max-w-screen-xl px-4 md:px-8 py-6">
          {issue ? (
            <div>
              <div className="flex items-start gap-3 mb-3">
                <StatusDropdownBadge
                  status={issue.status}
                  className="mt-1"
                  canEdit={canEdit && issue.status !== "deleted"}
                  itemId={issue.id}
                  itemAuthorPubkey={issue.pubkey}
                  repoCoords={repoAllCoords ?? issue.repoCoords}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "resolved", label: "Resolved" },
                    { value: "closed", label: "Closed" },
                  ]}
                />
                <EditableSubject
                  issueId={issue.id}
                  currentSubject={issue.currentSubject || issue.originalSubject}
                  canEdit={canEdit}
                  repoCoords={repoAllCoords ?? issue.repoCoords}
                  issueAuthorPubkey={issue.pubkey}
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground ml-[calc(theme(spacing.3)+4.5rem-3.5rem)]">
                <code className="font-mono text-xs text-muted-foreground/80">
                  #{issue.id.slice(0, 8)}
                </code>
                <UserLink
                  pubkey={issue.pubkey}
                  avatarSize="sm"
                  nameClassName="text-sm"
                />
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    {formatDistanceToNow(new Date(issue.createdAt * 1000), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {issue.labels.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {issue.labels.map((label) => (
                      <LabelBadge key={label} label={label} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Content */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        {!issue ? (
          <div className="min-h-[40vh] flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="h-8 w-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">Fetching issue…</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
            {/* Main content */}
            <div className="min-w-0 space-y-4">
              {/* Cover note — pinned note from author/maintainer */}
              {coverNoteEditing && issue ? (
                <CoverNoteBox
                  rootEvent={issue.rootEvent}
                  repoCoords={repoAllCoords ?? issue.repoCoords}
                  initialContent={issue.coverNotes?.[0]?.content ?? ""}
                  onSubmitted={() => setCoverNoteEditing(false)}
                  onCancel={() => setCoverNoteEditing(false)}
                  priorityPubkeys={mentionPriorityPubkeys}
                />
              ) : issue?.coverNotes && issue.coverNotes.length > 0 ? (
                <CoverNoteCard
                  events={issue.coverNotes}
                  onEdit={canEdit ? () => setCoverNoteEditing(true) : undefined}
                />
              ) : canEdit && issue ? (
                /* Subtle "Add cover note" button — only for authorised users */
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCoverNoteEditing(true)}
                  className="gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground h-7 -ml-2"
                >
                  <Pin className="h-3 w-3" />
                  Add cover note
                </Button>
              ) : null}

              {/* Issue body */}
              <EventBodyCard
                event={issue.rootEvent}
                content={issue.body}
                repoCoords={repoAllCoords ?? issue.repoCoords}
              />

              {/* Thread: comments + subject renames */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <MessageCircle className="h-4 w-4" />
                  <span>
                    {`${issue.commentCount} ${issue.commentCount === 1 ? "comment" : "comments"}`}
                  </span>
                </div>

                <Separator />

                {issue.timelineNodes.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground/60 text-sm">
                    No comments yet. The conversation awaits its first voice.
                  </div>
                ) : (
                  <div
                    className="min-w-0 border-l pl-1 space-y-0.5"
                    style={{ borderLeftColor: "rgb(59 130 246 / 0.5)" }}
                  >
                    {issue.timelineNodes.map((node, idx) => {
                      if (node.type === "rename") {
                        return (
                          <SubjectRenameCard
                            key={node.event.id}
                            event={node.event}
                            oldSubject={node.oldSubject}
                            newSubject={node.newSubject}
                            repoCoords={repoAllCoords ?? issue.repoCoords}
                          />
                        );
                      }
                      if (node.type === "status") {
                        return (
                          <StatusChangeCard
                            key={node.event.id}
                            event={node.event}
                            status={node.status}
                            authorised={node.authorised}
                            variant="issue"
                            repoCoords={repoAllCoords ?? issue.repoCoords}
                          />
                        );
                      }
                      if (node.type === "label") {
                        return (
                          <LabelChangeCard
                            key={node.event.id}
                            event={node.event}
                            labels={node.labels}
                            authorised={node.authorised}
                            repoCoords={repoAllCoords ?? issue.repoCoords}
                          />
                        );
                      }
                      // thread node
                      return (
                        <ThreadTree
                          key={`thread-${node.node.event.id}-${idx}`}
                          node={node.node}
                          threadContext={
                            activeAccount && issue
                              ? {
                                  rootEvent: issue.rootEvent,
                                  repoCoords: repoAllCoords ?? issue.repoCoords,
                                  priorityPubkeys: mentionPriorityPubkeys,
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Reply box — always shown; anonymous posting handled inside */}
              {issue && (
                <ReplyBox
                  rootEvent={issue.rootEvent}
                  priorityPubkeys={mentionPriorityPubkeys}
                />
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Stats card */}
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Status
                    </span>
                    <StatusDropdownBadge
                      status={issue?.status ?? "open"}
                      canEdit={canEdit && !!issue && issue.status !== "deleted"}
                      itemId={issue?.id}
                      itemAuthorPubkey={issue?.pubkey}
                      repoCoords={repoAllCoords ?? issue?.repoCoords}
                      options={[
                        { value: "open", label: "Open" },
                        { value: "resolved", label: "Resolved" },
                        { value: "closed", label: "Closed" },
                      ]}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <MessageCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Comments</span>
                      <span className="ml-auto font-medium">
                        {issue?.commentCount ?? 0}
                      </span>
                    </div>

                    {!!issue?.zapTotal && (
                      <div className="flex items-center gap-2 text-sm">
                        <Zap className="h-4 w-4 text-amber-500" />
                        <span className="text-muted-foreground">Zaps</span>
                        <span className="ml-auto font-medium">
                          {issue.zapTotal} sats
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Participants
                      </span>
                      <span className="ml-auto font-medium">
                        {issue?.participants.length ?? 0}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  {/* Participant avatars */}
                  {issue && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Participants
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {issue.participants.map((pk) => (
                          <UserAvatar
                            key={pk}
                            pubkey={pk}
                            size="sm"
                            linkToProfile
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Labels */}
                  {issue && (canEdit || issue.labels.length > 0) && (
                    <>
                      <Separator />
                      <ManageLabels
                        itemId={issue.id}
                        repoCoords={repoAllCoords ?? issue.repoCoords}
                        currentLabels={issue.labels}
                        canEdit={canEdit && issue.status !== "deleted"}
                        labelEventMap={labelEventMap}
                        issueAuthorPubkey={issue.pubkey}
                      />
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Back link */}
              <Link
                to={`${repoToPath(pubkey, repoId, repo?.relays ?? [], nip05)}/issues`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to issues
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
