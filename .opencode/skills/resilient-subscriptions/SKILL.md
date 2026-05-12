---
name: resilient-subscriptions
description: Use `resilientSubscription` / `resilientRequest` from `@/lib/resilientSubscription` to fetch Nostr events from relays. Activates when querying relays, building a custom observable pipeline, paginating a feed, computing reactive counts from the EventStore, or working with tag filters that the base `Filter` type doesn't include.
license: MIT
compatibility: opencode
metadata:
  framework: applesauce-v6
  audience: developers
---

# Resilient Subscriptions and EventStore Queries

`@/lib/resilientSubscription` is the **only sanctioned way** to fetch events from relays in this project. It wraps `pool.subscription()` with smart reconnect, foreground-resume gap-fill, EOSE settle signal, optional pagination, and per-relay error isolation.

## Never call these directly

```text
pool.subscription()
pool.req()
pool.relay(url).subscription()
pool.relay(url).request()
```

Use `resilientSubscription` (long-lived) or `resilientRequest` (one-shot, completes after EOSE) instead. The only legitimate uses of `pool.relay(url)` without these wrappers are reading metadata observables (`connected$`, `icon$`) for UI display.

## Three query patterns

### 1. Two-layer hook — fetch then read (dominant pattern)

This is what virtually every feature hook in `src/hooks/` does (`useUserRepositories`, `useUserStarredRepos`, `useUserPinnedRepos`, `useUserActivity`, `useResolvedRepository`, etc.). One `use$` fires a relay subscription that pipes events into the EventStore; a second `use$` reads them back via `store.model(...)` / `store.timeline(...)` / `store.getByFilters(...)`.

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { pool } from "@/services/nostr";
import { resilientSubscription } from "@/lib/resilientSubscription";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

export function useUserRepositories(pubkey: string | undefined) {
  const store = useEventStore();

  // Layer 1: fetch into the EventStore. Return undefined to short-circuit
  // when inputs aren't ready — use$ tolerates undefined factories.
  use$(() => {
    if (!pubkey) return undefined;
    return resilientSubscription(
      pool,
      gitIndexRelays,
      [{ kinds: [REPO_KIND], authors: [pubkey] } as Filter],
      { paginate: true },
    ).pipe(onlyEvents(), mapEventsToStore(store));
  }, [pubkey, store]);

  // Layer 2: read reactively from the store.
  return use$(() => {
    if (!pubkey) return undefined;
    return store.model(RepositoryListModel, pubkey) as unknown as Observable<
      ResolvedRepo[]
    >;
  }, [pubkey, store]);
}
```

The Layer 1 `use$` is fire-and-forget — its return value isn't read. The Layer 2 `use$` is what the component renders from. Copy `src/hooks/useUserRepositories.ts` as the canonical template.

### 2. Inline `resilientSubscription` / `resilientRequest` for one-offs

For pagination flows, search, or anywhere outside a feature hook where Layer 2 isn't needed:

```tsx
import { resilientRequest, resilientSubscription } from "@/lib/resilientSubscription";
import { mapEventsToTimeline } from "applesauce-core";

// One-shot fetch (completes after EOSE)
const events = use$(
  () =>
    resilientRequest(pool, ["wss://relay.damus.io"], [{ kinds: [1], authors: [pubkey] }]).pipe(
      onlyEvents(),
      mapEventsToStore(store),
      mapEventsToTimeline(),
    ) as unknown as Observable<NostrEvent[]>,
  [pubkey, store],
);

// Long-lived subscription (stays open, reconnects, gap-fills)
const live = use$(
  () =>
    resilientSubscription(pool, relays, filters).pipe(
      onlyEvents(),
      mapEventsToStore(store),
      mapEventsToTimeline(),
    ) as unknown as Observable<NostrEvent[]>,
  [relayKey, filterKey, store],
);
```

See `src/lib/searchForEvent.ts` and `src/services/userIdentitySubscription.ts` for non-hook examples.

### 3. `store.getByFilters` / `store.timeline` — local-only

Query events already in the EventStore without touching relays. This is the right move on pages with pre-wired loaders (`RepoLayout`, `IssuePage`, `PRPage`):

```ts
const cached = store.getByFilters({ kinds: [1], limit: 20 });
const live = store.timeline([{ kinds: [1] }]); // observable
```

## Options

| Option       | Default | Description                                                              |
| ------------ | ------- | ------------------------------------------------------------------------ |
| `autoClose`  | `false` | Complete after EOSE (use `resilientRequest` instead of setting this).    |
| `paginate`   | `false` | Auto backward-paginate after EOSE.                                       |
| `limit`      | `500`   | Page size for pagination.                                                |
| `settle`     | `true`  | Emit `"EOSE"` settle signal alongside events.                            |
| `retryCount` | `3`     | Reconnect attempts before giving up.                                     |
| `reconnect`  | `true`  | Smart reconnect with `since: lastReceivedAt - gapFillBuffer`.            |
| `gapFill`    | `true`  | Gap-fill on foreground resume (app coming back from background).         |

## `mapEventsToTimeline()` return type

TypeScript infers it as `unknown`. Cast the pipeline result explicitly:

```ts
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

const events = use$(
  () =>
    resilientSubscription(pool, relays, filters).pipe(
      onlyEvents(),
      mapEventsToStore(store),
      mapEventsToTimeline(),
    ) as unknown as Observable<NostrEvent[]>,
  [relayKey, filterKey, store],
);
// events is now NostrEvent[] | undefined
```

## Tag filters not in the base `Filter` type

The base `Filter` type from `applesauce-core/helpers` does not include every tag filter. When filtering by `#a`, `#E` (uppercase), `#t`, or any other custom tag, cast the filter:

```ts
import type { Filter } from "applesauce-core/helpers";

const filter1 = { kinds: [1621], "#a": [repoCoord] } as Filter;
const filter2 = { kinds: [1111], "#E": [issueId] } as Filter;
const filter3 = { kinds: [1], "#t": ["farming"] } as Filter;
```

**Uppercase vs. lowercase tag filters:**

- Lowercase single-letter tags (`#e`, `#p`, `#a`, `#t`) are indexed by relays.
- Uppercase tags (`#E`, `#P`, `#A`) are used by NIP-22 (comments) to reference the **root** of a thread, vs. the immediate reply parent.
- Always check the NIP spec to know which case a tag uses.

## Conditional / optional observables

When the factory depends on optional parameters, return `undefined` early **inside the factory** rather than conditionally calling the hook. The dep array must remain stable:

```ts
// ✅ Correct
const events = use$(
  () => {
    if (!repoCoord) return undefined; // use$ handles undefined gracefully
    const filter = { kinds: [1621], "#a": [repoCoord] } as Filter;
    return resilientSubscription(pool, relays, [filter]).pipe(
      onlyEvents(),
      mapEventsToStore(store),
      mapEventsToTimeline(),
    ) as unknown as Observable<NostrEvent[]>;
  },
  [repoCoord, relayKey, store],
);

// ❌ Wrong — conditional hook call breaks rules of hooks
if (!repoCoord) return null;
const events = use$(() => resilientSubscription(...).pipe(...), [store]);
```

**Always include every variable the factory closes over** in the dep array, even optional ones. Missing deps cause stale subscriptions; extra deps only cause harmless re-subscriptions.

## Reactive counts from the EventStore

To reactively display a count (comments on an issue, follower count, etc.), subscribe to `store.timeline()` and `map` to `.length`:

```ts
import { map } from "rxjs/operators";
import type { Filter } from "applesauce-core/helpers";

function useEventCount(filters: Filter[]): number {
  const store = useEventStore();
  const filterKey = JSON.stringify(filters);
  return use$(
    () => store.timeline(filters).pipe(map((events) => events.length)),
    [filterKey, store],
  ) ?? 0;
}

// Comment-count badge on an issue
const filter = { kinds: [1111], "#E": [issue.id] } as Filter;
const commentCount = useEventCount([filter]);
```

Note: this counts events already in the store — pair it with a sibling subscription (the Layer 1 `use$` from the two-layer pattern, or any `resilientSubscription` whose pipeline runs `mapEventsToStore`) so the events are actually present.

## High-cardinality tag-value fan-out — `createPaginatedTagValueLoader`

For `#e` / `#E` / `#a` / `#q` queries that fan out across many tag values (every issue's status events, every comment's children, every repo's items), use **`createPaginatedTagValueLoader`** from `@/lib/tagValuePaginatedLoader` instead of opening a fresh `resilientSubscription` per item.

It is a drop-in replacement for applesauce's `createTagValueLoader` that adds:

- per-relay backward pagination (auto or manual via `manualPaginate$`)
- a persistent live subscription with the same exponential-backoff / rate-limit / permanent-error handling as `resilientSubscription`
- per-batch EOSE settle signal (emits `"EOSE"` 200ms after the first relay finishes)
- in-memory exhaustion tracking so re-mounted components skip pagination

Calls within the same `bufferTime` window are batched into one REQ per relay automatically — so for N items you get **one** subscription per relay, not N. **Always reuse the existing singletons** in `src/services/nostr.ts` rather than creating a new instance:

| Singleton                       | Tag | Purpose                                                                          |
| ------------------------------- | --- | -------------------------------------------------------------------------------- |
| `nip34EssentialsLoader`         | `e` | status (1630-1633), labels (1985), deletions (5), cover notes, legacy replies   |
| `nip34CommentsLoader`           | `E` | NIP-22 comments (1111), PR updates (1619)                                       |
| `nip34EssentialDeletionsLoader` | `e` | kind:5 deletions of essential events                                            |
| (private thread loaders)        | `e`/`E`/`q` | fired internally by `nip34ThreadItemLoader` for full thread fan-out  |

Only instantiate a new `createPaginatedTagValueLoader` when you have a genuinely new tag-value fan-out shape that none of the singletons cover.
