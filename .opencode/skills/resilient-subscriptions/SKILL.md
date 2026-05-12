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

### 1. `useTimeline` — recommended for feeds

```tsx
import { useTimeline } from "@/hooks/useTimeline";
import { Article } from "applesauce-common/casts";

const notes = useTimeline(["wss://relay.damus.io"], [{ kinds: [1], limit: 50 }]);
const articles = useTimeline(relays, [{ kinds: [30023], limit: 20 }], Article);
```

Internally uses `resilientSubscription` and casts via `castTimelineStream`. Defaults to the `Note` cast; pass another cast class for other kinds.

### 2. Custom pipeline with `resilientSubscription` / `resilientRequest`

For pagination, custom reactivity, or non-trivial cast pipelines:

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { pool } from "@/services/nostr";
import { resilientRequest, resilientSubscription } from "@/lib/resilientSubscription";
import { onlyEvents, mapEventsToStore, mapEventsToTimeline } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

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

### 3. `store.getEvents` / `store.timeline` — local-only

Query events already in the EventStore without touching relays:

```ts
const cached = store.getEvents({ kinds: [1], limit: 20 });
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

Note: this counts events already in the store — pair it with a sibling subscription that loads the events into the store, or use `useTimeline` / a custom `resilientSubscription` whose pipeline runs `mapEventsToStore`.

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
