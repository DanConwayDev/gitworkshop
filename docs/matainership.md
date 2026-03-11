# Selected Maintainer Model for Web Clients

**Purpose:** Reference document for web client developers displaying ngit repositories  
**Audience:** Client developers who need to understand how to discover, validate, and display multi-maintainer repositories

---

## What Is a Repository?

A repository in the ngit model is **not** simply a pubkey + identifier pair. A repository is:

> **An identifier string plus the interconnected set of pubkeys that mutually acknowledge each other through the maintainer chain.**
> The set of pubkeys that recursively list each other as maintainers, with the same identifier, defines the boundary of that repository as a single collaborative unit.

## This distinction matters enormously for display. Two pubkeys that both have announcements for `my-project` and mutually list each other are **the same repository**. Two pubkeys that both have announcements for `my-project` but do not connect through the maintainer chain are **two different repositories** that happen to share a name.

## Repository Announcements (NIP-34 Kind 30617)

Each participant in a repository publishes a **repository announcement event** (kind 30617), signed by their Nostr keypair, containing:

- `d` tag: the repository identifier (e.g. `my-project`)
- `name` tag: human-readable name
- `description` / content: description text
- `clone` tag: git clone URLs for their copy
- `relays` tag: Nostr relays where events for this repo are published
- `maintainers` tag: zero or more pubkeys they recognize as co-maintainers
- `r` tag: earliest unique commit (root commit for original repos, a later commit for forks)
- `web` tag: web URLs (e.g. gitworkshop.dev link)

---

## The Maintainer Chain

### Direct Maintainers

An announcement can list additional maintainers:

```
Alice's announcement for "my-project":
  maintainers: [Bob, Carol]
```

Bob and Carol are authorized to push state events for Alice's copy of `my-project`.

### Recursive Maintainers

Any listed maintainer can themselves publish an announcement for the same identifier, listing further maintainers:

```
Bob's announcement for "my-project":
  maintainers: [Dave]
```

Dave is now a **recursive maintainer** — authorized because Alice lists Bob, and Bob lists Dave. Alice's full authorized set = {Alice, Bob, Dave}.
The chain can be arbitrarily deep. The relay computes the full transitive closure via `get_maintainers_recursive()` (`src/git/authorization.rs:386`) with cycle detection to prevent infinite loops.

### Mutual Listing = One Repository

When two pubkeys list each other (directly or transitively), they form a single repository unit:

```
Alice's announcement for "my-project": maintainers: [Bob]
Bob's announcement for "my-project":   maintainers: [Alice]
```

These are not two separate repositories. They are one repository with two maintainers. The git data is synchronized between them, state events from either are authoritative for the whole, and issues/PRs/labels from either are part of the same project.

### Splitting: When the Chain Breaks

The repository unit **splits** when the maintainer chain is severed — i.e. when one party removes the other and the transitive connection no longer exists.
Example: Alice removes Bob from her maintainers list:

```
Alice's new announcement for "my-project": maintainers: []
Bob's announcement for "my-project":       maintainers: [Alice]
```

Now Alice's chain and Bob's chain are disconnected (Alice no longer reaches Bob). They are now **two separate repositories** that happen to share an identifier. Their git histories will diverge, their state events are no longer mutually authoritative, and their issues/PRs/labels belong to separate projects.
Note the asymmetry: Bob still lists Alice, so from Bob's perspective Alice is still in his maintainer set. But Alice no longer lists Bob, so Alice's repository has split off. A full clean split only completes when both parties have removed each other.

---

## What the Maintainer Set Makes Authoritative

When a set of pubkeys forms a connected repository unit, **all of them are authoritative** for that repository. Specifically, clients SHOULD treat events from the recursive maintainer set as authoritative:

### State Events (Kind 30618)

A state event declares the current branch/tag heads of the repository. State events from **any pubkey in the recursive maintainer set** are authoritative for the repository. The latest state event (by timestamp) from any authorized maintainer defines the canonical state.

### Issue, PR, and Patch Status Events

Status updates on issues (kind 1621), pull requests (kind 1618/1619), and patches are authoritative when authored by any member of the recursive maintainer set. A maintainer closing an issue or merging a PR carries the same weight regardless of which specific maintainer in the set authored the event.

### NIP-32 Labels

NIP-32 labels (kind 1985) applied to repository content (commits, issues, PRs) by members of the recursive maintainer set are **authoritative**. Labels from outside the maintainer set are **helpful suggestions** — they may be displayed but should be visually distinguished from maintainer-authored labels.

> Clients SHOULD treat labels from the recursive maintainer set as authoritative, and non-maintainer-provided labels as helpful suggestions.

## This distinction is important: a random user labeling an issue "bug" is a suggestion. A maintainer labeling it "bug" is a definitive classification.

## The `RepoRef`: How a Client Resolves a Repository

The ngit CLI's `RepoRef` struct (`src/lib/repo_ref.rs:34`) is the canonical in-memory representation of a resolved repository. Understanding how it is built is essential for client implementors.

### The `selected_maintainer` Field

`RepoRef` has a `selected_maintainer: PublicKey` field — the single pubkey that was the starting point for resolution. This is the npub the user navigated to (e.g. from a nostr URL or a link). It anchors the coordinate used to reference the repository: `naddr` coordinates always point to the selected maintainer's pubkey + identifier.
This is distinct from the full `maintainers` list, which contains all pubkeys in the connected chain.

### Recursive Discovery in `get_repo_ref_from_cache`

The function `get_repo_ref_from_cache` (`src/lib/client.rs:1428`) shows exactly how a client should resolve a repository from a starting coordinate:

```
1. Start with the selected maintainer's pubkey in a set
2. Fetch all kind 30617 events for (pubkey, identifier) for every pubkey in the set
3. For each event found, add all listed maintainers to the set
4. If any new pubkeys were added, loop back to step 2
5. Continue until no new pubkeys are discovered (fixed point)
```

This is the recursive chain resolution. The loop terminates because the set only grows and pubkeys are only added once.

### Field Merging: Latest vs Union

Once all maintainer announcement events are collected, fields are merged with two different strategies:
**Fields taken from the latest event (by `created_at`) across all maintainers:**

- `name`
- `description`
- `web`
  These are "shared metadata" — the most recently updated version wins, regardless of which maintainer published it. This reflects that any maintainer can update the project's display name or description.
  **Fields unioned across all maintainer events:**
- `relays` — all relays from all announcements, deduplicated
- `git_server` (clone URLs) — all clone URLs from all announcements, deduplicated
- `blossoms` — all blossom server URLs, deduplicated
  These are "infrastructure" — each maintainer hosts their own copy, and clients should know about all of them.
  **Fields taken from the selected maintainer's own event:**
- `identifier`
- `root_commit` (earliest unique commit)
- `selected_maintainer` (always the starting pubkey)
  **The full maintainer set:**
- `maintainers` — the complete set of all pubkeys discovered through the recursive chain, not just those listed in the selected maintainer's own event
  The `maintainers_without_announcement` field tracks pubkeys that are listed as maintainers but have not yet published their own announcement event for this identifier.

---

## How Issues, PRs, and Patches Reference the Repository

Issues, PRs (pull requests), and patches all tag **every maintainer's announcement** using NIP-01 `a` tags (addressable event coordinates). This is the mechanism that ties these events to the full repository unit rather than to a single pubkey's copy.
From `src/lib/git_events.rs`, when generating a patch, PR, or cover letter event.
This means every patch/PR/issue event contains `a` tags of the form:

```
["a", "30617:<maintainer-pubkey>:<identifier>", "<relay-hint>"]
```

— one for each maintainer in the connected set.

### Why This Matters for Clients

A client querying for issues/PRs/patches for a repository should **filter by any of the maintainer coordinates**, not just the selected maintainer's coordinate. An issue tagged with Bob's coordinate is just as much a part of the repository as one tagged with Alice's coordinate, provided Alice and Bob are in the same maintainer chain.
Practically: to fetch all issues for a repository, query for kind 1621 events that have an `a` tag matching `30617:<any-maintainer-pubkey>:<identifier>`.
Also note: maintainer pubkeys are also added as `p` tags on patches/PRs (for notification routing), but the `a` tags are the authoritative repository reference.

---

## The Selected Maintainer: A User's Starting Anchor

### The Problem

A web client cannot independently verify every repository on the network. Anyone can publish a kind 30617 announcement claiming to maintain any project. The client needs a starting point for resolution.

### The Solution: One Selected Maintainer Per User

Each user configures **a single selected maintainer** — one npub they have chosen (e.g. a developer whose identity they have verified out-of-band). This is the root of their discovery graph.
From that single anchor, the client discovers repositories and other maintainers by following the maintainer chain recursively. This mirrors how discovery works in practice: you select specific people, and through them you discover others.
This is a deliberate design constraint. Multiple roots would complicate the model significantly and are not needed — the recursive chain handles the multi-maintainer case naturally.

### Discovery Flow

Given a user's selected maintainer T:

1. Fetch T's announcements (kind 30617 authored by T)
2. For each announcement, resolve the full recursive maintainer chain (as above)
3. The resulting interconnected set of pubkeys + identifier = one repository to display
   Different users with different selected maintainers may arrive at the same repository from different directions. User 1 selects Alice, User 2 selects Bob — if Alice and Bob are in the same maintainer chain for `my-project`, both users see the same repository. The `selected_maintainer` field in each user's resolved `RepoRef` will differ (Alice vs Bob), but the underlying repository — its name, description, git data, issues, PRs — is the same.

---

## The Scam: Unilateral Listing

### The Attack

Eve wants her repository to appear legitimate. She publishes:

```
Eve's announcement for "my-project":
  maintainers: [Alice]   ← Alice is a well-known developer
```

Alice has never heard of Eve's project. But if a client naively displays "Alice is a maintainer of this repository", users may trust Eve's repo because of Alice's reputation.

### Why It's Not an Authorization Problem

From the relay's perspective this is harmless: being listed in Eve's announcement does not give Alice any push rights over Eve's repo — Alice still needs to publish her own state events. The relay's authorization logic only cares about the chain of announcements, not reputation.

### Why It IS a Display Problem

A client that shows Alice as a maintainer of Eve's repo is misleading users. It could be used to lend false legitimacy to a scam project, a malicious fork, or a phishing repository.

### The Solution: Only Show Chain-Reachable Maintainers

A client should only display a pubkey as a maintainer if they are **reachable from the user's selected maintainer** via the recursive chain.
If the user selects Alice, and Alice does not list Eve (and Eve is not reachable from Alice's chain), then Eve's repository simply does not appear. If Eve lists Alice but Alice does not list Eve back, Alice should **not** be shown as a maintainer of Eve's repository — the relationship is unilateral and unacknowledged.
The chain must connect in both directions (transitively) for two pubkeys to be considered part of the same repository unit.

---

## Practical Display Guidelines

### Defining a Repository for Display

A repository shown to the user is:

- A single identifier string
- Plus the full set of pubkeys connected through mutual maintainer listings, reachable from the user's selected maintainer
  All announcements in that connected set are part of the same repository. Show them unified, not as separate entries.

### Displaying Repository Metadata

| Field       | Source                                                             |
| ----------- | ------------------------------------------------------------------ |
| Name        | Latest event (by `created_at`) across all maintainer announcements |
| Description | Latest event across all maintainer announcements                   |
| Web URLs    | Latest event across all maintainer announcements                   |
| Clone URLs  | Union of all maintainer announcements (all copies available)       |
| Relays      | Union of all maintainer announcements                              |
| Maintainers | Full recursive set                                                 |

### Authoritative vs Suggestive Content

| Content type                    | Authoritative if authored by | Otherwise             |
| ------------------------------- | ---------------------------- | --------------------- |
| State events (branch/tag heads) | Any recursive maintainer     | Ignore                |
| Issue/PR/patch status           | Any recursive maintainer     | Ignore                |
| NIP-32 labels                   | Any recursive maintainer     | Display as suggestion |
| General comments/reactions      | Any participant              | Display as-is         |

### Querying Issues, PRs, and Patches

To fetch all issues/PRs/patches for a repository, query for the relevant kinds with an `a` tag matching any of the maintainer coordinates:

```
kinds: [1621]  (issues)
#a: ["30617:<alice-pubkey>:<identifier>", "30617:<bob-pubkey>:<identifier>", ...]
```

Include all maintainer pubkeys in the filter, not just the selected maintainer's.

### Handling Forks / Splits

When two announcements share an identifier but are **not** connected through the maintainer chain:

- Treat them as separate repositories
- The user will see only the one(s) reachable from their selected maintainer
- If both are reachable (e.g. the user trusts someone in each chain), display them distinctly — they are different projects that share a name
- Consider a "related repositories" note if they share git history (same `r` root commit tag)

### The No-Trusted-Maintainer Case

Without a trust anchor the client has no basis for filtering. Options:

- Prompt the user to configure a selected maintainer before showing repositories
- Show all repositories with a clear "unverified" warning
- Default to showing only repositories where the logged-in user is in the maintainer chain

---

## Summary

| Concept                        | Definition                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Repository identity            | An identifier + the interconnected set of mutually-listing pubkeys                             |
| Maintainer chain               | Recursive: owner lists maintainers, who list their own maintainers, etc.                       |
| Same repository                | Two pubkeys that connect transitively through mutual maintainer listings                       |
| Split                          | The chain breaks — two formerly-connected pubkeys become separate repositories                 |
| Selected maintainer            | The single user-chosen npub that anchors all discovery                                         |
| `selected_maintainer` field    | The starting pubkey for resolution; used in naddr coordinates                                  |
| Name / description / web       | Taken from the latest announcement event across all maintainers                                |
| Clone URLs / relays            | Unioned across all maintainer announcements                                                    |
| Authoritative events           | State, issue/PR/patch status, and NIP-32 labels from any recursive maintainer                  |
| Suggestive events              | NIP-32 labels from outside the maintainer set                                                  |
| `a` tags on issues/PRs/patches | One per maintainer — all maintainer coordinates tagged, not just the selected one              |
| Scam prevention                | Only show maintainers reachable from the user's selected root — never show unilateral listings |

---
