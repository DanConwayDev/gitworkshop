import { combineLatest, of } from "rxjs";
import {
  auditTime,
  distinctUntilChanged,
  map,
  switchMap,
} from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import {
  PR_UPDATE_KIND,
  PR_ROOT_KINDS,
  LABEL_KIND,
  DELETION_KIND,
  STATUS_KINDS,
  COMMENT_KIND,
  LEGACY_REPLY_KINDS,
  PATCH_KIND,
  COVER_NOTE_KIND,
  resolveItemEssentials,
  extractBody,
  extractPatchDiff,
  buildRenameItems,
  buildTimelineNodes,
  resolveCoverNotes,
  type ResolvedPR,
  type PRRevision,
  type PRItemType,
} from "@/lib/nip34";
import { resolveAllChains } from "@/hooks/usePatchChain";
import { Patch, isValidPatch } from "@/casts/Patch";

/**
 * PRDetailModel — reactively resolves the full detail-page view of a single
 * PR or patch (kind:1618 or kind:1617).
 *
 * Subscribes to the EventStore for:
 * - The root event (kind 1617 or 1618)
 * - Essentials (status, labels, deletions)
 * - Comments (kind:1111 via #E, legacy kinds 1/1622 via #e, cross-revision merged)
 * - PR Updates (kind:1619) or patch chain patches (kind:1617 #e)
 * - Zaps (kind:9735)
 *
 * Emits a `ResolvedPR` whenever any of these change. The model handles the
 * PR-vs-Patch branching internally so the UI page never needs to know which
 * kind it's looking at.
 *
 * @param rootId      - The event ID of the root PR or patch
 * @param maintainers - The effective maintainer set (from repo resolution)
 */
export function PRDetailModel(
  rootId: string,
  maintainers: Set<string> | undefined,
): Model<ResolvedPR | undefined> {
  return (store) => {
    // All essential kinds fetched per-item
    const ESSENTIALS_KINDS = [
      ...STATUS_KINDS,
      LABEL_KIND,
      DELETION_KIND,
    ] as const;

    // Root event (kind 1617 or 1618)
    const root$ = store.timeline([
      { kinds: [...PR_ROOT_KINDS], ids: [rootId] },
    ]);

    // Essentials (status, labels, deletions)
    const essentials$ = store.timeline([
      { kinds: [...ESSENTIALS_KINDS], "#e": [rootId] } as Filter,
    ]);

    // Comments (kind:1111) — we'll merge cross-revision later
    // Start with comments rooted at the original root via NIP-22 #E tag
    const comments$ = store.timeline([
      { kinds: [COMMENT_KIND], "#E": [rootId] } as Filter,
    ]);

    // Legacy replies (kind 1, 1622) via NIP-10 #e tag
    const legacyReplies$ = store.timeline([
      { kinds: [...LEGACY_REPLY_KINDS], "#e": [rootId] } as Filter,
    ]);

    // PR Updates (kind:1619) and patch chain patches (kind:1617 #e)
    // Both use lowercase #e tag referencing the root
    const updates$ = store.timeline([
      { kinds: [PR_UPDATE_KIND, PATCH_KIND], "#e": [rootId] } as Filter,
    ]);

    // Cover notes (kind:1624) referencing this PR/patch via lowercase #e tag
    const coverNotes$ = store.timeline([
      { kinds: [COVER_NOTE_KIND], "#e": [rootId] } as Filter,
    ]);

    // Zaps
    const zaps$ = store.timeline([{ kinds: [9735], "#e": [rootId] } as Filter]);

    // Deletion events for all essential events (status, label/rename).
    // Derived reactively from essentials$: extract all non-deletion essential
    // event IDs, then query for kind:5 deletions referencing those IDs.
    // Re-subscribes automatically whenever the set of essential IDs changes.
    const essentialDeletions$ = essentials$.pipe(
      map((evs) =>
        (evs as NostrEvent[])
          .filter((e) => e.kind !== DELETION_KIND)
          .map((e) => e.id),
      ),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
      ),
      switchMap((essentialIds) => {
        if (essentialIds.length === 0) return of([] as NostrEvent[]);
        return store
          .timeline([{ kinds: [DELETION_KIND], "#e": essentialIds } as Filter])
          .pipe(map((evs) => evs as NostrEvent[]));
      }),
    );

    return combineLatest([
      root$,
      essentials$,
      comments$,
      legacyReplies$,
      updates$,
      coverNotes$,
      zaps$,
      essentialDeletions$,
    ]).pipe(
      auditTime(50),
      map(
        ([
          rootEvents,
          essentialEvents,
          commentEvents,
          legacyReplyEvents,
          updateEvents,
          coverNoteEvents,
          zapEvents,
          essentialDeletionEvents,
        ]) => {
          const roots = rootEvents as NostrEvent[];
          const rootEvent = roots[0];
          if (!rootEvent) return undefined;

          const essentials = essentialEvents as NostrEvent[];
          // Merge NIP-22 comments and legacy replies into a single list
          const allComments = [
            ...(commentEvents as NostrEvent[]),
            ...(legacyReplyEvents as NostrEvent[]),
          ];
          const updates = updateEvents as NostrEvent[];
          const coverNotes = coverNoteEvents as NostrEvent[];
          const zaps = zapEvents as NostrEvent[];

          // Determine item type
          const itemType: PRItemType =
            rootEvent.kind === PATCH_KIND ? "patch" : "pr";

          // Effective maintainer set (use provided or empty while loading)
          const effectiveMaintainers = maintainers ?? new Set<string>();

          // Split updates into PR Updates (kind:1619) and patches (kind:1617)
          const prUpdateEvents = updates.filter(
            (ev) => ev.kind === PR_UPDATE_KIND,
          );
          const patchEvents = updates.filter((ev) => ev.kind === PATCH_KIND);

          // Resolve core essentials using the shared pure function
          const core = resolveItemEssentials(
            rootEvent,
            essentials,
            allComments,
            zaps,
            effectiveMaintainers,
            {
              mergeStatusRequiresMaintainer: true,
              prUpdateEvents,
              essentialDeletionEvents: essentialDeletionEvents as NostrEvent[],
            },
          );

          // ── Build revisions ─────────────────────────────────────────
          let revisions: PRRevision[];
          let tipCommitId: string | undefined;
          let explicitMergeBase: string | undefined;
          let tipCloneUrls: string[] = [];

          if (itemType === "patch") {
            // Patch flow: resolve patch chains
            const castStore =
              store as unknown as import("applesauce-common/casts/cast").CastRefEventStore;
            const allPatches: Patch[] = [];

            // Cast root event
            if (isValidPatch(rootEvent)) {
              try {
                allPatches.push(new Patch(rootEvent, castStore));
              } catch {
                // Invalid patch — skip
              }
            }

            // Cast referencing patches
            for (const ev of patchEvents) {
              if (isValidPatch(ev)) {
                try {
                  allPatches.push(new Patch(ev, castStore));
                } catch {
                  // Invalid patch — skip
                }
              }
            }

            // Deduplicate
            const seen = new Set<string>();
            const dedupedPatches = allPatches.filter((p) => {
              if (seen.has(p.id)) return false;
              seen.add(p.id);
              return true;
            });

            const patchRevisions = resolveAllChains(rootId, dedupedPatches);

            revisions = patchRevisions.map((rev, idx) => ({
              type: "patch-set" as const,
              createdAt: rev.rootPatch.event.created_at,
              tipCommitId:
                rev.chain.length > 0
                  ? rev.chain[rev.chain.length - 1].commitId
                  : undefined,
              mergeBase:
                rev.chain.length > 0 ? rev.chain[0].parentCommitId : undefined,
              cloneUrls: extractCloneUrlsFromPatches(rev.chain),
              superseded: idx < patchRevisions.length - 1,
              pubkey: rev.rootPatch.pubkey,
              patches: rev.chain,
              rootPatchEvent: rev.rootPatch.event,
            }));

            // Tip from latest revision
            if (revisions.length > 0) {
              const latest = revisions[revisions.length - 1];
              tipCommitId = latest.tipCommitId;
              explicitMergeBase = latest.mergeBase;
              tipCloneUrls = latest.cloneUrls;
            }
          } else {
            // PR flow: resolve PR Updates
            const rootTipCommitId = rootEvent.tags.find(
              ([t]) => t === "c",
            )?.[1];
            const rootMergeBase = rootEvent.tags.find(
              ([t]) => t === "merge-base",
            )?.[1];
            const rootCloneUrls = rootEvent.tags
              .filter(([t]) => t === "clone")
              .flatMap(([, ...urls]) => urls.filter(Boolean));

            // Sort updates by created_at ascending
            const sortedUpdates = [...prUpdateEvents]
              .filter((ev) =>
                isPubkeyAuthorised(
                  ev.pubkey,
                  rootEvent.pubkey,
                  effectiveMaintainers,
                ),
              )
              .sort((a, b) => a.created_at - b.created_at);

            revisions = sortedUpdates.map((ev, idx) => ({
              type: "pr-update" as const,
              createdAt: ev.created_at,
              tipCommitId: ev.tags.find(([t]) => t === "c")?.[1],
              mergeBase: ev.tags.find(([t]) => t === "merge-base")?.[1],
              cloneUrls: ev.tags
                .filter(([t]) => t === "clone")
                .flatMap(([, ...urls]) => urls.filter(Boolean)),
              superseded: idx < sortedUpdates.length - 1,
              pubkey: ev.pubkey,
              updateEvent: ev,
            }));

            // Tip from latest update, falling back to root event
            if (revisions.length > 0) {
              const latest = revisions[revisions.length - 1];
              tipCommitId = latest.tipCommitId ?? rootTipCommitId;
              explicitMergeBase = latest.mergeBase ?? rootMergeBase;
              tipCloneUrls = deduplicateUrls([
                ...rootCloneUrls,
                ...latest.cloneUrls,
              ]);
            } else {
              tipCommitId = rootTipCommitId;
              explicitMergeBase = rootMergeBase;
              tipCloneUrls = rootCloneUrls;
            }
          }

          // ── Merge cross-revision comments ───────────────────────────
          // For patches: also include comments rooted at revision root patches
          const revisionRootIds =
            itemType === "patch"
              ? revisions
                  .filter(
                    (r) => r.rootPatchEvent && r.rootPatchEvent.id !== rootId,
                  )
                  .map((r) => r.rootPatchEvent!.id)
              : [];

          // allComments already has comments rooted at rootId (NIP-22 + legacy).
          // We need to also check for comments rooted at revision roots.
          // Note: these may not be in allComments$ since that only queries
          // #E:[rootId] and #e:[rootId]. The useResolvedPR hook handles
          // fetching revision-root comments via useNip34ItemLoaderBatch.
          // For now, we work with what's in the store.
          let mergedComments = [...allComments];
          if (revisionRootIds.length > 0) {
            // Query revision-root comments from the store synchronously
            // (both NIP-22 and legacy reply kinds)
            for (const revId of revisionRootIds) {
              const revComments = store.getByFilters([
                { kinds: [COMMENT_KIND], "#E": [revId] } as Filter,
              ]) as NostrEvent[];
              const revLegacy = store.getByFilters([
                { kinds: [...LEGACY_REPLY_KINDS], "#e": [revId] } as Filter,
              ]) as NostrEvent[];
              mergedComments.push(...revComments, ...revLegacy);
            }
            // Deduplicate
            const seenIds = new Set<string>();
            mergedComments = mergedComments.filter((ev) => {
              if (seenIds.has(ev.id)) return false;
              seenIds.add(ev.id);
              return true;
            });
          }

          // ── Cover note ─────────────────────────────────────────────
          const allCoverNotes = resolveCoverNotes(
            rootId,
            rootEvent.pubkey,
            coverNotes,
            core.authorisedUsers,
          );
          const coverNote = allCoverNotes[0];

          // ── Build rename items ──────────────────────────────────────
          const renameItems = buildRenameItems(
            core.originalSubject,
            core.subjectRenames,
            essentials,
          );

          // ── Build timeline nodes ────────────────────────────────────
          const timelineNodes = buildTimelineNodes({
            itemType,
            rootEvent,
            comments: mergedComments,
            essentials,
            authorisedUsers: core.authorisedUsers,
            deletedEssentialEventIds: core.deletedEssentialEventIds,
            revisions,
            revisionRootIds,
          });

          // ── Participants ────────────────────────────────────────────
          const participantSet = new Set<string>();
          participantSet.add(rootEvent.pubkey);
          for (const c of mergedComments) participantSet.add(c.pubkey);
          for (const r of revisions) participantSet.add(r.pubkey);

          // ── Patch diff ──────────────────────────────────────────────
          const patchDiff =
            itemType === "patch"
              ? extractPatchDiff(rootEvent.content)
              : undefined;

          // ── Initial patch commits (inline in body card) ─────────────
          // For patches: if the first revision's patches were all published
          // within a few seconds of the root event, inline them in the body
          // card (matching PR behaviour). If any patch in the first revision
          // has a timestamp more than 10 seconds after the root event, treat
          // the whole revision as a separate push event in the timeline.
          // ngit publishes patches sequentially — each one takes a few seconds.
          // Use a generous threshold so a multi-patch set published in one
          // `ngit send` invocation is treated as simultaneous.
          const INLINE_THRESHOLD_SECONDS = 60;
          let initialPatchCommits:
            | Array<{
                commitId: string | undefined;
                eventId: string;
                subject: string;
              }>
            | undefined;
          let firstRevisionInlined = false;
          let hasCoverLetter = false;

          if (itemType === "patch" && revisions.length > 0) {
            const firstRevision = revisions[0];
            if (
              firstRevision.type === "patch-set" &&
              firstRevision.patches &&
              firstRevision.patches.length > 0
            ) {
              // Detect cover letter: root patch itself, or first patch in chain
              hasCoverLetter = firstRevision.patches.some(
                (p) => p.isCoverLetter,
              );

              const allSimultaneous = firstRevision.patches.every(
                (p) =>
                  Math.abs(p.event.created_at - rootEvent.created_at) <=
                  INLINE_THRESHOLD_SECONDS,
              );
              if (allSimultaneous) {
                initialPatchCommits = firstRevision.patches
                  .filter((p) => !p.isCoverLetter)
                  .map((p) => ({
                    commitId: p.commitId,
                    eventId: p.event.id,
                    subject: p.subject || "(no subject)",
                  }));
                firstRevisionInlined = true;
              }
            }
          }

          return {
            // Core fields from resolveItemEssentials
            id: core.id,
            pubkey: core.pubkey,
            event: core.event,
            itemType,
            originalSubject: core.originalSubject,
            currentSubject: core.currentSubject,
            content: core.content,
            createdAt: core.createdAt,
            lastActivityAt: core.lastActivityAt,
            status: core.status,
            labels: core.labels,
            repoCoords: core.repoCoords,
            commentCount: mergedComments.length,
            participantCount: participantSet.size,
            zapCount: core.zapCount,
            authorisedUsers: core.authorisedUsers,
            deletedEssentialEventIds: core.deletedEssentialEventIds,

            // Detail fields
            body: extractBody(rootEvent),
            coverNote,
            coverNotes: allCoverNotes,
            revisions,
            tip: {
              commitId: tipCommitId,
              explicitMergeBase,
              cloneUrls: tipCloneUrls,
            },
            timelineNodes,
            comments: mergedComments,
            zaps,
            renameItems,
            participants: Array.from(participantSet),
            rootEvent,
            maintainers: effectiveMaintainers,
            patchDiff: patchDiff || undefined,
            initialPatchCommits,
            firstRevisionInlined,
            hasCoverLetter,
          } satisfies ResolvedPR;
        },
      ),
    );
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a pubkey is authorised to write status, label, or
 * PR Update events for a given PR/patch.
 */
function isPubkeyAuthorised(
  pubkey: string,
  itemPubkey: string,
  maintainers: Set<string>,
): boolean {
  if (maintainers.size === 0) return true; // still loading
  return pubkey === itemPubkey || maintainers.has(pubkey);
}

/** Extract clone URLs from a chain of patches. */
function extractCloneUrlsFromPatches(chain: Patch[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const p of chain) {
    for (const tag of p.event.tags) {
      if (tag[0] === "clone") {
        for (const url of tag.slice(1)) {
          if (url && !seen.has(url)) {
            seen.add(url);
            urls.push(url);
          }
        }
      }
    }
  }
  return urls;
}

/** Deduplicate URLs while preserving order. */
function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}
