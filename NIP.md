# ngitstack Custom Nostr Events

## Notification Read State (kind 30078)

Uses [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md) (Arbitrary Custom App Data) to persist notification read/archived state across devices.

### Event Structure

```json
{
  "kind": 30078,
  "tags": [["d", "git-notifications-state"]],
  "content": "<NIP-44 encrypted JSON>"
}
```

### Encrypted Content Schema

The `content` field is NIP-44 encrypted to self (the user's own pubkey). When decrypted, it contains a JSON object with the following fields:

| Field | Type       | Description                                                                                            |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `rb`  | `number`   | Unix timestamp (seconds). All notification events with `created_at <= rb` are considered **read**.     |
| `ri`  | `string[]` | Event IDs individually marked as read that have `created_at > rb` (exceptions after the cutoff).       |
| `ab`  | `number`   | Unix timestamp (seconds). All notification events with `created_at <= ab` are considered **archived**. |
| `ai`  | `string[]` | Event IDs individually marked as archived that have `created_at > ab` (exceptions after the cutoff).   |

### Example (decrypted content)

```json
{
  "rb": 1711900000,
  "ri": ["aabb...", "ccdd..."],
  "ab": 1711800000,
  "ai": ["eeff..."]
}
```

### Design Rationale

The high-water-mark model keeps the payload compact:

- The timestamp cutoff (`rb`/`ab`) marks everything older as read/archived without storing individual IDs.
- The ID arrays (`ri`/`ai`) only hold exceptions — events newer than the cutoff that have been individually acted on.
- Periodically the cutoff is advanced and the arrays are pruned, keeping the payload bounded.

This is the same model used by [gitworkshop.dev](https://gitworkshop.dev) for notification state, adapted from localStorage to NIP-78 for cross-device sync.

---

## Pinned Git Repositories (kind 10617)

A NIP-51 standard replaceable list that stores a user's curated, ordered set of their own repositories to highlight on their profile page.

### Event Structure

```json
{
  "kind": 10617,
  "tags": [
    ["a", "30617:<pubkey>:<dtag>"],
    ["a", "30617:<pubkey>:<dtag>"]
  ],
  "content": ""
}
```

### Tag Schema

| Tag | Description                                                                       |
| --- | --------------------------------------------------------------------------------- |
| `a` | Address pointer to a kind:30617 repository announcement. One tag per pinned repo. |

### Ordering

The order of `a` tags in the event is significant — it defines the display order of pinned repositories on the user's profile page. Clients SHOULD preserve tag order when modifying the list and SHOULD append new pins to the end.

### Design Rationale

Follows the same NIP-51 standard list pattern as:

- kind:10017 — Git authors follow list
- kind:10018 — Git repositories follow list

Uses `a` tags (address pointers to kind:30617 announcements) consistent with kind:10018. The list is intended for a user's **own** repositories only, acting as a curated showcase rather than a general-purpose follow list.

---

## Inline Code Review Comments (kind:1111)

Inline comments on NIP-34 patches and pull requests follow [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md) with additional tags for code location context.

The NIP-22 root (`E`/`K`/`P`) is always the original PR (kind:1618) or patch (kind:1617). The parent (`e`/`k`/`p`) is either that same event or a PR update (kind:1619) when commenting on a specific revision.

```jsonc
{
  "kind": 1111,
  "content": "<comment>",
  "tags": [
    // NIP-22 root — the PR or patch
    ["E", "<pr-or-patch-event-id>", "<relay>", "<author-pubkey>"],
    ["K", "<1618-or-1617>"],
    ["P", "<author-pubkey>", "<relay>"],

    // NIP-22 parent — same as root, or a PR update (1619) for revision-specific comments
    ["e", "<pr-patch-or-update-event-id>", "<relay>", "<author-pubkey>"],
    ["k", "<1618-or-1617-or-1619>"],
    ["p", "<author-pubkey>"],

    // repository reference — one per maintainer
    ["q", "30617:<maintainer-pubkey>:<repo-id>", "<relay>"],
    ["q", "30617:<co-maintainer-pubkey>:<repo-id>", "<relay>"], // repeat for each maintainer

    // file path
    ["f", "<path/to/file.rs>"],

    // the commit for which the comment applies, typically where the lines in question were added/removed
    ["c", "<commit-id>"],

    // line or range within the file at the specified commit (optional), e.g. "42" or "42-48"
    // to refer to pre-commit removed lines use `["line", "3-6", "del"]` instead
    ["line", "<line-or-range>"],
  ],
}
```

Replies to an inline comment are standard NIP-22 replies: `E`/`K`/`P` remain the original PR/patch; `e`/`k`/`p` point to the inline comment (kind:1111).

### Inline Suggestions

A reviewer can propose a specific replacement for the lines referenced by the `line` tag by including a fenced code block with the language identifier `suggestion` in the comment `content`. The fence contains the exact replacement lines (without indentation changes relative to the original). The `line` tag on the same event defines the range being replaced.

````markdown
```suggestion
    let result = compute(x, y);
    result
```
````

Clients that understand suggestions SHOULD render an "Apply suggestion" button that constructs a patch replacing the referenced lines with the suggestion content and presents it to the PR author. Clients that do not understand suggestions display the fenced block as a normal code block, so the suggestion remains human-readable.

Rules:

- A suggestion MUST have a `line` tag specifying the range to replace.
- A suggestion MUST have an `f` tag specifying the file.
- A suggestion MUST have a `c` tag specifying the commit the suggestion applies to.
- The suggestion content replaces the referenced lines verbatim; reviewers SHOULD preserve surrounding indentation.
- A comment MAY contain prose outside the suggestion fence.

### Resolving a Thread

Any sub-thread (an inline comment or any NIP-22 comment thread) can be resolved by posting a kind:1111 reply with a `l` tag of `"resolved"`. Clients that don't support resolution see it as a normal comment. The thread is considered resolved if such an event exists and has not been deleted.

```jsonc
{
  "kind": 1111,
  "content": "marked as resolved",
  "tags": [
    // NIP-22 root — unchanged from the rest of the thread
    ["E", "<pr-or-patch-event-id>", "<relay>", "<author-pubkey>"],
    ["K", "<1618-or-1617>"],
    ["P", "<author-pubkey>", "<relay>"],

    // NIP-22 parent — the sub-thread root being resolved
    ["e", "<thread-root-comment-id>", "<relay>", "<author-pubkey>"],
    ["k", "1111"],
    ["p", "<author-pubkey>"],

    // resolution state
    ["l", "resolved"],
  ],
}
```

To check whether a specific comment thread is resolved without fetching the whole PR thread:

```jsonc
{ "kinds": [1111], "#e": ["<thread-root-comment-id>"], "#l": ["resolved"] }
```

### Relay Queries

```jsonc
// all inline comments on a repository
{ "kinds": [1111], "#q": ["30617:<pubkey>:<repo-id>"] }

// all inline comments on a specific file
{ "kinds": [1111], "#q": ["30617:<pubkey>:<repo-id>"], "#f": ["src/parser/mod.rs"] }

// all inline comments on a PR (all revisions)
{ "kinds": [1111], "#E": ["<pr-event-id>"] }

// all inline comments targeting a specific commit
{ "kinds": [1111], "#c": ["<commit-id>"] }
```

---

## Pull Request Reviews (kind:7321)

A PR review groups one or more inline comments (kind:1111) under a single verdict event. Any user can submit a review; the verdict is not authoritative over the PR's open/merged/closed state (that remains with NIP-34 kinds 1630–1633).

### Verdict values (`s` tag)

| Value              | Meaning                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACK`              | Reviewer has tested or carefully read the code and approves it as-is.                                                                                            |
| `NACK`             | Reviewer objects to the change; the PR should not be merged in its current form.                                                                                 |
| `Concept ACK`      | Reviewer agrees with the goal/approach but has not fully reviewed the implementation.                                                                            |
| `Concept NACK`     | Reviewer disagrees with the goal or approach regardless of implementation quality.                                                                               |
| `Changes Required` | Reviewer has identified specific changes that must be made before the PR can be merged; typically accompanied by inline comments detailing what needs to change. |

### Event Structure

```jsonc
{
  "kind": 7321,
  "content": "<optional overall review summary / prose>",
  "tags": [
    // NIP-34 PR or patch being reviewed (required)
    ["e", "<pr-or-patch-event-id>", "<relay>", "root"],
    ["p", "<pr-or-patch-author-pubkey>"],

    // verdict (required)
    ["s", "<ACK|NACK|Concept ACK|Concept NACK|Changes Required>"],

    // inline comments included in this review (zero or more)
    // each q tag references a kind:1111 comment event published by the same author
    ["q", "<comment-event-id>", "<relay>"],
    ["q", "<comment-event-id>", "<relay>"],

    // NIP-31 alt tag for clients that don't understand kind:7321
    [
      "alt",
      "Pull request review: <ACK|NACK|Concept ACK|Concept NACK|Changes Required>",
    ],
  ],
}
```

### Rules

- The review event MUST be authored by the reviewer (not the PR author or a maintainer acting on their behalf).
- Each `q` tag referencing a comment MUST point to a kind:1111 event authored by the same pubkey as the review event.
- The `s` tag value MUST be one of the five verdict strings above (case-sensitive).
- `content` is optional but SHOULD be used for an overall summary when the verdict alone is insufficient.
- A review is immutable once published. To change a verdict, publish a new kind:7321 event; the most recent event by `created_at` from a given pubkey for a given PR is considered the current verdict.

### Relay Queries

```jsonc
// all reviews on a PR or patch
{ "kinds": [7321], "#e": ["<pr-or-patch-event-id>"] }

// all ACK reviews on a PR
{ "kinds": [7321], "#e": ["<pr-event-id>"], "#s": ["ACK"] }

// all reviews by a specific reviewer
{ "kinds": [7321], "authors": ["<reviewer-pubkey>"] }
```

### Design Rationale

- **Regular (not replaceable) kind**: review history is preserved. Clients display the most recent verdict per reviewer by sorting on `created_at`.
- **`s` tag for verdict**: single-letter tag, relay-indexed, enabling efficient filtering by verdict without fetching event content.
- **`q` tags for comments**: comments are explicitly enumerated so clients can reconstruct the exact set of comments belonging to a review without scanning all PR comments.
- **Separate from 1630–1633 status kinds**: those are authoritative state changes by maintainers; a review is a reviewer's opinion and carries no merge authority.

---

## Shared Issue / Patch / PR Metadata

The following features apply uniformly to all three NIP-34 root item kinds — issues (kind:1621), patches (kind:1617), and pull requests (kind:1618). They let an item be re-tagged, re-titled, or annotated **after the fact**, without modifying (or being able to modify — these are regular, immutable events) the original root event.

### Authorisation

All three features share the same authorisation rule: an event is only **authoritative** if its author is either

1. the **root item author** (the pubkey that published the issue/patch/PR), or
2. a **confirmed maintainer** of the repository (a pubkey in the repo's transitive maintainer set — see the "Repository authorization model" in `AGENTS.md`).

Events from any other pubkey are ignored when deriving the item's effective state. Because the maintainer set is only known once the repo announcements load, clients MAY treat the root author as authorised before maintainers resolve to avoid a flash of missing metadata.

### After-the-fact Labels (NIP-32, kind:1985)

Labels are attached to an item with a [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) label event. The label namespace is `#t` (the same convention NIP-34 root items use for inline `t` tags), declared with an `L` tag and carried in one or more `l` tags.

```jsonc
{
  "kind": 1985,
  "content": "",
  "tags": [
    // root item being labelled (NIP-10 root pointer)
    ["e", "<issue-patch-or-pr-event-id>", "<relay>", "root"],

    // namespace declaration
    ["L", "#t"],

    // one l tag per label, all in the #t namespace
    ["l", "bug", "#t"],
    ["l", "needs-triage", "#t"],
  ],
}
```

An item's effective label set is the union of:

- the root event's own inline `t` tags, and
- every `l` tag (namespace `#t`) from **authorised** kind:1985 events referencing it,

deduplicated and sorted. Labels are additive across multiple label events; a label event is itself a regular event and can be removed with a NIP-09 deletion (kind:5) by its author. Label events are fetched as part of the per-item "essentials" loader (`#e` fan-out).

### Subject Edits (NIP-32, kind:1985 with `#subject` namespace)

A subject (title) edit reuses the same kind:1985 label event but with the dedicated namespace `#subject`. The label value is the new subject string.

```jsonc
{
  "kind": 1985,
  "content": "",
  "tags": [
    // root item being re-titled (NIP-10 root pointer)
    ["e", "<issue-patch-or-pr-event-id>", "<relay>", "root"],

    // subject-rename namespace
    ["L", "#subject"],

    // the new subject/title
    ["l", "Fix race condition in the merge queue", "#subject"],
  ],
}
```

The item's **effective subject** is the value of the latest authorised `#subject` rename event by `created_at` (ties broken by event ID); if no authorised rename exists, the subject falls back to the root event's original `subject` tag. Clients SHOULD render renames as timeline entries distinct from `#t` labels so the edit history is visible.

### Cover Notes (kind:1624)

A cover note is a pinned, editable note posted by the item author or a maintainer that renders **above** the item's first description card — useful for status banners, summaries, or "blocked on X" context. Unlike the root event, a cover note can be superseded at any time by publishing a newer one.

```jsonc
{
  "kind": 1624,
  "content": "<markdown body>",
  "tags": [
    // root item being annotated (NIP-10 #e with "root" marker)
    ["e", "<issue-patch-or-pr-event-id>", "<relay>", "root"],
    ["p", "<root-item-author-pubkey>"],
    ["k", "<1621-1617-or-1618>"],

    // optional NIP-94 imeta tags for embedded Blossom uploads
    ["imeta", "url https://...", "..."],

    // NIP-31 alt tag for clients that don't understand kind:1624
    ["alt", "Cover note for a git issue or PR"],
  ],
}
```

Resolution rules:

- Only **authorised** cover notes (root author or maintainer) are considered.
- The **latest** authorised cover note by `created_at` (ties broken by event ID, descending) is the one displayed.
- All authorised cover notes are retained so clients MAY surface edit history; older notes by other authorised authors remain queryable.

Cover notes reference the root via **lowercase** NIP-10 `#e` (not the uppercase NIP-22 `#E`), so they thread alongside legacy NIP-34 replies and are fetched by the repo-level cover-note loader.

### Relay Queries

```jsonc
// all labels and subject renames on an item (both are kind:1985)
{ "kinds": [1985], "#e": ["<item-event-id>"] }

// cover notes on an item
{ "kinds": [1624], "#e": ["<item-event-id>"] }
```

### Design Rationale

- **Regular, immutable events**: the root issue/patch/PR is never mutated. Labels, renames, and cover notes are separate events whose authority is decided by the author + maintainer rule, so anyone can _propose_ but only authorised pubkeys _affect state_.
- **NIP-32 for labels and subjects**: reuses a standard kind rather than minting a custom one; the `#subject` namespace cleanly separates renames from `#t` categorisation while sharing the same event shape and loader.
- **`#t` namespace alignment**: matches the inline `t` tags on root items so the union of both sources is the natural label set.
- **Cover note as kind:1624 with lowercase `#e`**: mirrors gitworkshop's CoverNote feature and keeps cover notes inside the NIP-10 thread the repo loader already fetches.

---

## CI Workflow Events (kinds 9841, 9842, and 39842) — consumed

This project **consumes** (does not define) the experimental CI events published by [`ngit-ci`](https://github.com/DanConwayDev/ngit-ci) for NIP-34 repositories. The authoritative event shapes are defined in [ngit-ci's working Nostr CI NIP](https://gitworkshop.dev/npub15qydau2hjma6ngxkl2cyar74wzyjshvl65za5k5rl69264ar2exs5cyejr/ngit-ci/tree/master/NIP.md), which is implemented but has not yet been merged into the upstream NIPs repository. ngit-ci is working with Hive-CI to achieve consensus around a shared CI standard; this is the working NIP for that effort. This section documents the subset gitworkshop relies on and how it fetches and interprets it.

- **Kind 9841 — Job Result**: an attestation of an individual job outcome, signed by the compute provider that ran it. `content` holds a small log tail; the full log is referenced with a `logs` tag.
- **Kind 9842 — Workflow Result**: the coordinator-signed combined outcome of a workflow run, with `q` tags that reference its Job Results.
- **Kind 39842 — Workflow Progress** (optional): an addressable, NIP-40-expiring marker for a queued, in-progress, or recently concluded workflow run.

All three kinds share the common context tags:

```jsonc
[
  ["a", "30617:<repo-owner-pubkey>:<repo-id>"],
  ["c", "<commit-id>"],
  ["w", "<workflow-file-path>", "<sha256-of-workflow-file-content>"],
  ["o", "<push|pull_request|manual|schedule>"],
]
```

Multi-maintainer repositories are announced under one kind:30617 coordinate per maintainer, so CI events MAY carry **multiple `a` tags** — one per maintainer coordinate. gitworkshop passes the repo's full transitive coordinate set (see §"Repository authorization model" in `docs/matainership.md`) in every `#a` filter and store read, so an event tagged under any maintainer's coordinate is found.

PR-triggered workflows additionally carry NIP-22-style trigger tags — uppercase `E`/`K`/`P` for the root PR (kind:1618) and lowercase `e`/`k`/`p` for the concrete trigger (the PR itself, or a kind:1619 PR Update). Push-triggered workflows carry `["r", "refs/heads/<branch>"]` instead.

Job Result-specific tags on kind:9841 include `job`, `conclusion`, `logs`, and optionally `name`, `artifact`, `queued_at`, `started_at`, `exit_code`, and `runs_on`. Workflow Results (kind:9842) carry a combined `conclusion` plus a `q` tag for each Job Result. Workflow Progress (kind:39842) adds an addressable `d` tag, `status` (`queued`, `in_progress`, or `concluded`), optional `queue` and `in-progress` tags, and a NIP-40 `expiration` tag.

### Fetching strategy

```jsonc
// PR checks — CI activity rides the #E comments fan-out for every repo item
{ "kinds": [1111, 1619, 9841, 9842, 39842], "#E": ["<pr-or-patch-event-id>"] }

// Workflow progress — fetched repo-wide; NIP-40 expiry keeps the set small
{ "kinds": [39842], "#a": ["30617:<maintainer-pubkey>:<repo-id>", "..."] }

// Commit status ticks — batched per page of displayed commits
{ "kinds": [9842], "#c": ["<commit-id>", "<commit-id>", "..."] }

// Actions tab — all CI activity repo-wide, fetched on demand
{ "kinds": [9841, 9842, 39842], "#a": ["30617:<maintainer-pubkey>:<repo-id>", "..."] }

// Actions tab visibility — one-shot limit-1 presence probe per repo visit
{ "kinds": [9841, 9842, 39842], "#a": ["30617:<maintainer-pubkey>:<repo-id>", "..."], "limit": 1 }
```

- **PR / patch pages and lists**: kinds:9841, 9842, and 39842 are fetched alongside NIP-22 comments via the `#E` root-tag loader, so PR list rows and detail pages get CI activity with no extra subscriptions. The no-kind thread loader on detail pages also picks up all three kinds.
- **Kind:39842** is fetched once per repo via the `#a` coordinate filter in the repo meta subscription — because markers expire (NIP-40), the live set stays small. Expired markers are dropped at display time and re-checked periodically so pending spinners clear without a new event.
- **Commit ticks** (CodeBar head commit, commit history rows, commit detail page) fetch kind:9842 by `#c` for exactly the commits being displayed; a singleton batched loader collapses a page of commits into one REQ per relay.
- **Actions tab**: a repo-wide live `#a` subscription for all three kinds runs only while the tab is open (kind:9841 events carry log tails and can be large, so this is not fetched eagerly). Tab visibility is decided by a cheap one-shot limit-1 probe fired from the repo layout, combined with any CI events already in the store from the other loaders.

### Interpretation rules

- Each immutable kind:9842 event represents a distinct **workflow run attempt**, even when multiple attempts share the same coordinator, commit, and workflow path. A Workflow Result links only the Job Results that make up that attempt through its `q` tags; clients MUST NOT merge attempts merely because their shared context tags match.
- A Job Result with matching `c` and `w` context but no available Workflow Result that quotes it is an **orphaned job result**. Clients SHOULD display it as a partial run rather than attaching it to an unrelated attempt or dropping it.
- An unexpired kind:39842 Workflow Progress marker counts as **pending** while its `status` is `queued` or `in_progress`; a newer marker for the same `d` tag replaces the earlier state, while different `d` tags are separate attempts.
- Roll-up uses the workflow's `conclusion`, with job-level `conclusion` values available from the referenced kind:9841 events. Clients MUST tolerate the NIP's standard conclusion values: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, and `startup_failure`.
- Clients MUST NOT require a kind:39842 progress marker to accept a kind:9842 Workflow Result — publishing progress is optional.

### Trust model

**None yet, by design.** Any pubkey can publish CI events for any repository; gitworkshop displays all of them and always renders the signing runner identity next to each result so users can judge for themselves. If spam appears, a trust model (maintainer-designated runners, follow-based filtering) will be layered on without changing the event shapes.
