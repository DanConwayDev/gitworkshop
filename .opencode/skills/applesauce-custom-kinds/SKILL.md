---
name: applesauce-custom-kinds
description: Build, store, and query a project-specific Nostr event kind using the Applesauce v6 three-layer pattern — Factory (`src/factories/`) for building/signing, Cast (`src/casts/`) for typed reactive access, and a hook (`src/hooks/`) for subscriptions. Activates when adding a new custom kind, parsing a non-trivial existing kind, or refactoring code that manually parses `NostrEvent.tags`.
license: MIT
compatibility: opencode
metadata:
  framework: applesauce-v6
  audience: developers
---

# Applesauce v6 Custom Event Kinds

For any non-trivial domain-specific kind (NIP-34 issues/patches/repos, custom DSL events, etc.), follow the three-layer pattern. **Never** manually parse `NostrEvent.tags` in hooks or components — wrap raw events in a typed cast.

## The three layers

| Layer   | Directory        | Responsibility                                                                                  |
| ------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| Factory | `src/factories/` | Build + sign events; subclass `EventFactory<K>`                                                 |
| Cast    | `src/casts/`     | Typed wrapper around a raw event with memoised getters; subclass `EventCast`                    |
| Hook    | `src/hooks/`     | Subscribe to relays via `resilientSubscription`, cast events via `castTimelineStream`           |

Shared relay-hint resolvers live in `src/factories/hints.ts`.

## v5 → v6 differences (one-time read)

- `src/operations/` and `src/blueprints/` directories from v5 are **gone**. Operations live in `applesauce-core/operations/...`; build flows are encoded directly in factory subclasses.
- The global `EventFactory` singleton is **gone**. Each factory class is instantiated per-call: `IssueFactory.create(...).sign(signer)`.
- Action context exposes `signer` (and `self`), not a `factory` field.
- Relay-hint resolvers are passed **per-call** to tag operations (`addAddressPointerTag(addr, getPubkeyRelayHint)`), not globally to the factory constructor.

## Layer 1: Factory

```typescript
// src/factories/IssueFactory.ts
import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { includeContentHashtags } from "applesauce-core/operations/content";
import {
  addAddressPointerTag,
  addNameValueTag,
  addProfilePointerTag,
} from "applesauce-core/operations/tag/common";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";
import { ISSUE_KIND } from "@/lib/nip34";
import { getPubkeyRelayHint } from "./hints";

export interface IssueOptions { labels?: string[] }
type IssueTemplate = KnownEventTemplate<typeof ISSUE_KIND>;

export class IssueFactory extends EventFactory<typeof ISSUE_KIND, IssueTemplate> {
  static create(
    repoCoord: string,
    ownerPubkey: string,
    subject: string,
    content: string,
    options?: IssueOptions,
  ): IssueFactory {
    let factory = new IssueFactory((resolve) =>
      resolve(blankEventTemplate(ISSUE_KIND)),
    )
      .content(content)
      .modifyPublicTags(
        addAddressPointerTag(repoCoord, getPubkeyRelayHint),
        addProfilePointerTag(ownerPubkey, getPubkeyRelayHint),
      )
      .modifyPublicTags((tags) => [...tags, ["subject", subject]])
      .chain(includeContentHashtags())
      .alt(`Git issue: ${subject}`);

    for (const label of options?.labels ?? []) {
      factory = factory.modifyPublicTags(addNameValueTag(["t", label]));
    }
    return factory;
  }

  /** Fluent instance method for chaining additional ops. */
  label(label: string): this {
    return this.modifyPublicTags(addNameValueTag(["t", label]));
  }
}
```

**Building blocks:**

- `blankEventTemplate(K)` — fresh template for a new event.
- `toEventTemplate(event)` — start from an existing event (for edits).
- `.content(...)`, `.modifyPublicTags(...)`, `.alt(...)`, `.chain(...)` — inherited fluent helpers.
- `addAddressPointerTag` / `addProfilePointerTag` — pointer tags with relay-hint resolvers.
- `includeContentHashtags()` — auto-extract `#tag` mentions into `t` tags.
- Always pass `getPubkeyRelayHint` (or `getEventRelayHint` for `e` pointers) when adding pointer tags — improves cross-client discoverability for free.

**Look up additional operations** in the Applesauce MCP (`applesauce_search_methods`) — there are many in `applesauce-core/operations/...`.

## Using the factory

**Inside an Action** (preferred — uses outbox + EventStore optimistic update):

```typescript
import type { Action } from "applesauce-actions";
import { IssueFactory } from "@/factories/IssueFactory";
import { eventStore } from "@/services/nostr";
import { outboxStore } from "@/services/outbox";

export function CreateIssue(repoCoord: string, ownerPubkey: string, subject: string, content: string): Action {
  return async ({ signer, self }) => {
    const signed = await IssueFactory.create(repoCoord, ownerPubkey, subject, content).sign(signer);
    eventStore.add(signed); // optimistic
    outboxStore.publish(signed, [`outbox:${self}`, repoCoord]).catch(console.error);
  };
}
```

**Outside an action** (component / hook):

```typescript
const account = useAccount();
const signed = await IssueFactory.create(...).sign(account!.signer);
await publish(signed); // publish() from @/services/nostr
```

## Layer 2: Cast

```typescript
// src/casts/Issue.ts
import { EventCast, CastRefEventStore } from "applesauce-common/casts";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

export const ISSUE_KIND = 1621;
type IssueEvent = KnownEvent<typeof ISSUE_KIND>;

const SubjectSymbol = Symbol.for("issue-subject");
const RepoCoordSymbol = Symbol.for("issue-repo-coord");
const LabelsSymbol = Symbol.for("issue-labels");

export function isValidIssue(event: NostrEvent): event is IssueEvent {
  return event.kind === ISSUE_KIND
    && !!getTagValue(event, "subject")
    && !!event.tags.find(([t]) => t === "a");
}

export class Issue extends EventCast<IssueEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidIssue(event)) throw new Error("Invalid issue event");
    super(event, store);
  }

  get subject(): string {
    return getOrComputeCachedValue(this.event, SubjectSymbol,
      () => getTagValue(this.event, "subject")!);
  }

  get repoCoord(): string {
    return getOrComputeCachedValue(this.event, RepoCoordSymbol,
      () => this.event.tags.find(([t]) => t === "a")![1]);
  }

  get labels(): string[] {
    return getOrComputeCachedValue(this.event, LabelsSymbol,
      () => this.event.tags.filter(([t]) => t === "t").map(([, v]) => v));
  }

  // `this.author` (a User cast with `.profile$` etc.) is provided by EventCast.
}
```

**Rules:**

- One `Symbol.for(...)` per computed property. `getOrComputeCachedValue` caches the result on the raw event so repeated reads across all components are O(1).
- Validate in the constructor — if `isValidIssue` fails, **throw**. `castTimelineStream` silently drops casts that throw, so invalid events never reach the UI.
- Reactive observables (e.g. `this.author.profile$`, `this.replies$`) are inherited from `EventCast` — use them in components with `use$()`.

## Layer 3: Hook

```typescript
// src/hooks/useIssues.ts
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { pool } from "@/services/nostr";
import { resilientRequest } from "@/lib/resilientSubscription";
import { castTimelineStream } from "applesauce-common/observable";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { Issue, ISSUE_KIND } from "@/casts/Issue";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

const RELAYS = ["wss://relay.damus.io"]; // or use the project's NIP-65 outbox/inbox

export function useIssues(repoCoord: string | undefined): Issue[] | undefined {
  const store = useEventStore();

  // Side-effect: fetch from relay → write to store
  use$(() => {
    if (!repoCoord) return undefined;
    const filter = { kinds: [ISSUE_KIND], "#a": [repoCoord] } as Filter;
    return resilientRequest(pool, RELAYS, [filter]).pipe(
      onlyEvents(),
      mapEventsToStore(store),
    );
  }, [repoCoord, store]);

  // Read: store timeline → cast to Issue
  return use$(() => {
    if (!repoCoord) return undefined;
    const filter = { kinds: [ISSUE_KIND], "#a": [repoCoord] } as Filter;
    return store
      .timeline([filter])
      .pipe(castTimelineStream(Issue, store)) as unknown as Observable<Issue[]>;
  }, [repoCoord, store]);
}
```

**Two `use$` calls, no `useMemo`.** The first triggers the fetch side-effect; the second is the reactive read. Both must include every closure variable in the dep array, even optional ones — see the `react-rxjs-observables` skill for the dep-array rules.

## Using the cast in components

```tsx
function IssueRow({ issue }: { issue: Issue }) {
  const profile = use$(issue.author.profile$);
  return (
    <li>
      <span>{issue.subject}</span>
      <span>{profile?.name ?? issue.author.npub.slice(0, 12)}</span>
      <span>{issue.labels.join(", ")}</span>
    </li>
  );
}
```

## Anti-patterns to avoid

| Wrong                                            | Right                                                 |
| ------------------------------------------------ | ----------------------------------------------------- |
| `parseIssue(ev)` helper called in hook/component | `castTimelineStream(Issue, store)` in the pipeline   |
| `useMemo` to transform raw events                | Cast getters memoised by `Symbol.for(...)` keys      |
| Status/derived map built in hook                 | Status logic on the cast class or a related model    |
| `NostrEvent[]` typed return                      | `Issue[]` typed return                                |
| `use$` + `useMemo` + `use$`                      | Two `use$` calls (fetch + read)                       |
