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
    ["line", "<line-or-range>"],
  ],
}
```

Replies to an inline comment are standard NIP-22 replies: `E`/`K`/`P` remain the original PR/patch; `e`/`k`/`p` point to the inline comment (kind:1111).

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

### Notification Events

The following events are considered "notifications" for a user with pubkey `P`:

1. **NIP-22 comments** (kind 1111) on NIP-34 issues/PRs/patches authored by `P`:
   - Filter: `{ kinds: [1111], "#P": [P], "#K": ["1617", "1618", "1621"] }`

2. **New issues/PRs/patches** that tag `P` directly:
   - Filter: `{ kinds: [1621, 1618, 1617, 1, 1622], "#p": [P] }`

Events authored by `P` themselves are excluded from the notification list.
