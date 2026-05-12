---
name: nip22-comments
description: Build comment threads on non-kind-1 Nostr events using NIP-22 (kind:1111). Activates when adding replies/comments to NIP-34 issues/patches, NIP-23 articles, or any non-kind-1 root event, or when querying comments by thread root.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

# NIP-22 Comments (kind:1111)

Replies to **non-kind-1** events (NIP-34 issues/patches, NIP-23 articles, etc.) use **kind:1111** (NIP-22), not kind:1 replies. NIP-22 distinguishes the **thread root** (uppercase tags) from the **immediate reply parent** (lowercase tags).

## Tag conventions

| Tag | Case      | Meaning                                                    |
| --- | --------- | ---------------------------------------------------------- |
| `E` | Uppercase | Event ID of the **root** of the thread                     |
| `P` | Uppercase | Pubkey of the root event's author                          |
| `e` | Lowercase | Event ID of the **immediate reply parent**                 |
| `p` | Lowercase | Pubkey of the immediate parent's author                    |
| `k` | Lowercase | Kind number (string) of the root event                     |

For a top-level reply (parent **is** the root), `E === e` and `P === p`.

## Querying comments on a root event

```ts
import type { Filter } from "applesauce-core/helpers";

const filter = { kinds: [1111], "#E": [issueEventId] } as Filter;
// `#E` (uppercase) finds every comment in the thread, at any depth.
```

To find only direct replies to a specific comment, filter by lowercase `#e`:

```ts
const filter = { kinds: [1111], "#e": [parentCommentId] } as Filter;
```

The base `Filter` type doesn't include `#E` / `#P` — cast as shown.

## Publishing a comment on a NIP-34 issue

```ts
await publishEvent({
  kind: 1111,
  content: "This looks like a bug in the parser.",
  tags: [
    ["E", issueEventId, relayHint, "root"],     // uppercase = root
    ["P", issueAuthorPubkey, relayHint],        // uppercase = root author
    ["e", issueEventId, relayHint, "reply"],    // lowercase = immediate parent
    ["p", issueAuthorPubkey],                   // lowercase = immediate parent author
    ["k", "1621"],                              // kind of the root (NIP-34 issue)
  ],
});
```

For a reply to **another comment**:

```ts
tags: [
  ["E", rootIssueId,    relayHint, "root"],
  ["P", rootAuthorPubkey, relayHint],
  ["e", parentCommentId, relayHint, "reply"],
  ["p", parentCommentAuthor],
  ["k", "1621"],
],
```

## Reactive comment count

Use `useEventCount` (see the `resilient-subscriptions` skill) to display a comment count badge:

```tsx
const filter = { kinds: [1111], "#E": [issue.id] } as Filter;
const commentCount = useEventCount([filter]);
```

## Loading the thread tree

`src/lib/threadTree.ts` is the project's existing helper for building a nested reply tree from a flat list of kind:1111 events. Use it rather than re-implementing tree-building logic.
