# Project Overview

This is **gitworkshop** — a Nostr-native Git collaboration client (issues, PRs, repos via NIP-34 + NIP-22 comments, GRASP repo announcements) built with React 18, TailwindCSS 3, Vite, shadcn/ui, and Applesauce v6.

## Technology Stack

- **React 18.x**: hooks, concurrent rendering
- **TailwindCSS 3.x**: utility-first styling
- **Vite**: dev server + production bundler
- **shadcn/ui**: 48+ unstyled accessible primitives in `@/components/ui` on Radix UI + Tailwind
- **Applesauce v6** (`applesauce-core`, `applesauce-relay`, `applesauce-react`, `applesauce-loaders`, `applesauce-actions`, `applesauce-accounts`, `applesauce-signers`, `applesauce-common`, `applesauce-content`): reactive Nostr SDK on RxJS
- **RxJS**: state and reactive data flow via observables (load the `react-rxjs-observables` skill)
- **React Router**: client-side routing with `BrowserRouter` and automatic scroll-to-top
- **TypeScript**: type-safe JS. **Never use `any`.**
- **pnpm**: package manager. Use `pnpm` exclusively, never `npm` or `yarn`.

## Applesauce MCP — your primary reference

An Applesauce MCP server is configured at `https://mcp.applesauce.build/mcp`. **Use it heavily.** It serves up-to-date docs, method signatures, type definitions, and source examples directly from the Applesauce repo.

Always prefer the MCP over guessing or relying on this file when you need to:

- Look up method signatures, types, or interfaces (`applesauce_search_methods`)
- Find the right class, hook, or utility for a task (`applesauce_search_docs`, `applesauce_search_examples`)
- Confirm correct usage of a model, cast, action, or loader (`applesauce_read_doc`, `applesauce_read_example`)
- Check what's exported from a specific package

This file deliberately avoids enumerating models, casts, actions, hooks, and loaders that the MCP can answer better and more accurately.

## Project Structure

- `/src/services/` — singletons. `nostr.ts` exports `pool`, `eventStore`, `publish`. Plus `accounts.ts`, `actions.ts`, `outbox.ts`, `notificationStore.ts`, `cache.ts`, `settings.ts`.
- `/src/lib/` — utilities. **`resilientSubscription.ts` is the only sanctioned way to fetch events from relays** (see "Querying" below).
- `/src/factories/` — typed `EventFactory` subclasses for project-specific kinds (NIP-34 issues, PRs, repo announcements, statuses). Shared relay-hint resolvers live in `hints.ts`.
- `/src/casts/` — typed `EventCast` wrappers around raw events with memoised computed properties (`Issue`, `Patch`, `PR`, `Repository`, `RepositoryState`).
- `/src/components/` — UI. `ui/` is shadcn/ui primitives; `auth/` has `LoginArea`, `AuthModal`, `AccountSwitcher`, etc.
- `/src/hooks/` — custom hooks (`use$`, `useEventStore`, `useAccount`, `useTimeline`, `useEvents`, `usePublish`, `useAction`, plus dozens of feature hooks). List with `ls src/hooks/`.
- `/src/pages/` — page components used by React Router.
- `/src/types/` — TypeScript type definitions.
- `/src/test/` — testing utilities including `TestApp`.
- `/patches/` — pnpm dependency patches (see "Dependency Policy").
- `/docs/` — long-form architecture documents (e.g. `matainership.md` covers the multi-maintainer repo model).
- `App.tsx` — **already configured** with `EventStoreProvider`, `AccountsProvider`, `UnheadProvider`, `AppProvider`. **Read before editing**; changes are rarely needed.
- `AppRouter.tsx` — React Router configuration.

**Always read an existing file before modifying it.** Never write over `App.tsx`, `AppRouter.tsx`, `src/services/nostr.ts`, or `src/services/accounts.ts` without first reading their contents.

## UI Components

shadcn/ui primitives live in `@/components/ui`. List the directory (`ls src/components/ui/`) — all common primitives are present (buttons, inputs, dialogs, dropdowns, forms, tables, etc.). They use `React.forwardRef` and the `cn()` class-merge utility.

**Avatars:** Don't use `Avatar` directly to render another Nostr user's picture — use `UserAvatar` (or `UserLink`) from `@/components/UserAvatar`. They show the follow-indicator badge for users the current account follows, helping distinguish known contacts from impersonators. Raw `Avatar` is only appropriate for rendering your own account (`AccountSwitcher`, compose self-avatar) or non-user imagery.

## Dependency Policy

- **Use `pnpm`.** All scripts assume it (`pnpm test`, `pnpm dev`, `pnpm format`, `pnpm pre-commit`).
- **Prefer patching upstream over working around bugs.** When a dependency has a bug or missing feature, use [`pnpm patch`](https://pnpm.io/cli/patch) and commit the patch to `/patches/` rather than wrapping or duplicating logic in our codebase. `pnpm-workspace.yaml` already wires up `patchedDependencies` (see existing `applesauce-core@6.0.0.patch`, `applesauce-relay@6.0.0.patch`, `@jsr__fiatjaf__git-natural-api.patch`).
- This keeps our code aligned with upstream and makes the fix trivial to upstream later.

## Pre-commit and Test Scripts

The git pre-commit hook runs `pnpm pre-commit`, which runs `tsc --noEmit`, `eslint`, `prettier --write .` (auto-formats and re-stages), `vitest run`, and `vite build`. `pnpm test` is the same pipeline but with `prettier --check` (CI-style, no writes).

**Don't run `pnpm test`, `tsc`, `eslint`, `prettier`, or `vitest` separately as part of finishing a task** — committing already validates everything. Stage your changes and commit; if pre-commit rejects the commit, fix the reported error and commit again.

If you don't have a git pre-commit hook installed (fresh clone), copy this into `.git/hooks/pre-commit` and `chmod +x` it:

```sh
#!/bin/sh
pnpm pre-commit
```

## Nostr Protocol Integration

### Choosing kinds, designing tags, content vs. tags

1. **Always review existing NIPs first.** Use the NIP index tool, then read candidate NIPs in detail. Find the closest existing solution.
2. **Prefer extending existing NIPs** over creating custom kinds, even with minor schema compromises. Custom kinds fragment the ecosystem.
3. **When existing NIPs are close but not perfect**, use the existing kind as the base and add domain-specific tags. Document extensions in `NIP.md`.
4. **Only generate a new kind** when no existing NIP fits or storage characteristics differ. **If a tool to generate a new kind number is available, you MUST use it** — don't pick an arbitrary number.
5. **Custom kinds MUST include a NIP-31 `alt` tag** with a human-readable description.

**Tag design:**

- **Kind = schema, tags = semantics.** Don't create new kinds just for a different category of the same data.
- **Relays only index single-letter tags.** Use `t` for categories (`'#t': ['farming']`); multi-letter tags force inefficient client-side filtering.
- **Filter at the relay** — pass tag filters in the query rather than fetching everything and filtering in JS.

**Content vs. tags:**

- **Use `content` for** large freeform text or industry-standard JSON formats (kind 0 is the historical exception).
- **Use tags for** queryable metadata. If you need to filter by a field, it **must** be a tag — relays don't index content.
- **Empty content is fine** (`content: ""` is idiomatic for tag-only events).

**Kind ranges:** Regular (1000–9999) stored permanently; Replaceable (10000–19999) latest per `pubkey+kind`; Addressable (30000–39999) latest per `pubkey+kind+d`. Kinds below 1000 are legacy with per-kind storage rules (kind 1 is regular, kind 3 is replaceable).

### NIP.md

`NIP.md` documents custom kinds and schema extensions this project defines. **Whenever you generate a new kind or change a custom schema, update `NIP.md`.**

### Repository authorization model — non-negotiable

Nostr is permissionless: **anyone can publish any event.** A NIP-34 repository is _not_ a single pubkey + identifier; it's an identifier plus the **transitive maintainer chain** of pubkeys that mutually list each other in their kind:30617 announcements. Any event that participates in repo state (issues, patches, PRs, status events, labels, repo state kind:30618, repo announcements themselves) is only authoritative if its author is in that maintainer set — or, for issue/PR comments and statuses, the author of the root item.

**Rules:**

- **Always filter by `authors`** when fetching anything trust-bearing for a repo. Never trust an event because its `#a` / `#d` matches.
- **URLs for addressable events include the author**: `/:npub/:repoId/...`, never `/:repoId/...`. (See §"Routing" — multi-segment repo routes must be declared above the `/:nip19` catch-all.)
- **Don't roll your own author check.** The maintainer set is computed (with cycle detection) by the `Repository` cast in `src/casts/Repository.ts` and surfaced as `repo.maintainerSet` / `repo.allCoordinates` via `useResolvedRepository`. Pass those into any new query or status check; copy the pattern from `src/hooks/useIssues.ts`, `src/hooks/usePRs.ts`, or `src/hooks/useRepositoryState.ts`.
- **Background:** see `docs/matainership.md` for the full multi-maintainer model (recursive maintainers, mutual listing = one repo, splits when the chain breaks).

For events that are intentionally open (kind:1 notes, kind:7 reactions, follower kind:10018 lists, public discovery feeds), filtering by author defeats the point — don't.

### Querying Events from Relays

**CRITICAL:** never call `pool.subscription()`, `pool.req()`, `pool.relay().subscription()`, or `pool.relay().request()` directly for fetching events. Always use `resilientSubscription` / `resilientRequest` from `@/lib/resilientSubscription`. They provide smart reconnect with `since: lastReceivedAt` gap-fill, foreground-resume gap-fill, EOSE settle signal, optional backward pagination, rate-limit backoff, and per-relay error isolation.

Reading relay metadata observables (`connected$`, `icon$`) for UI display is fine without the wrappers — never for event fetching.

Patterns, in order of preference:

1. **Read from the EventStore** (`store.getByFilters(filters)` / `store.timeline(filters)` / `store.event(id)` / `store.model(...)`). On `RepoLayout`, `IssuePage`, and `PRPage` the relay fetches are already wired upstream (see "Pre-wired loaders" below). Components inside those pages should read from the store rather than opening their own subscriptions.
2. **`useTimeline(relays, filters, castClass?)`** — recommended for new top-level feeds. Defaults to the `Note` cast; pass `Article`, `Issue`, etc. for other kinds. Internally uses `resilientSubscription`.
3. **Custom pipeline with `resilientSubscription` / `resilientRequest`** — when you need pagination, custom reactivity, or a non-trivial cast pipeline.
4. **`createPaginatedTagValueLoader`** from `@/lib/tagValuePaginatedLoader` — drop-in replacement for applesauce's `createTagValueLoader` that adds per-relay backward pagination, persistent live subscription, rate-limit-aware reconnect, and an EOSE settle signal. Use it for high-cardinality `#e` / `#E` / `#a` / `#q` fan-out (essentials, comments, threads, repo-level item streams). The NIP-34 singletons in `src/services/nostr.ts` (`nip34EssentialsLoader`, `nip34CommentsLoader`, the thread loaders) are all instances of this — calls within the buffer window are batched into one REQ per relay automatically, so always reuse the singleton rather than instantiating a new one.

For options, conditional/optional observables, tag-filter casting (`#a`, `#E`, `#t`), reactive counts, and `mapEventsToTimeline()` typing, load the **`resilient-subscriptions`** skill.

#### Pre-wired loaders — don't duplicate them

Relay fetching for the main collaboration surfaces is already invoked at the page boundary; new code below those pages should _read_ from the EventStore rather than opening its own subscriptions:

- **`RepoLayout`** (`src/pages/repo/RepoLayout.tsx`) — fires `nip34RepoLoader` (via `useIssues` / `usePRs`) and, in outbox mode, `nip34SupplementalRelayLoader`. This loads every issue/PR root + their essentials (status, labels, deletions, cover notes, legacy replies) and NIP-22 comments for the whole repo. It also subscribes to repo meta (kind:7 stars, kind:10018 followers).
- **`IssuePage` / `PRPage`** — go through `useResolvedIssue` / `useResolvedPR` → `useNip34ItemDetailLoader`, which fires `nip34ListLoader` + `nip34ThreadItemLoader` for the item. The thread loader recursively pulls every event referencing the root or any comment via `#e` / `#E` / `#q` (reactions, zaps, deletions, quotes, child comments) — no kind restriction.

Inside any component or hook on those pages, the right move is `store.getByFilters(...)` / `store.timeline(...)` / `store.model(...)` (see `src/hooks/useInlineComments.ts` for an example). Only reach for `resilientSubscription` / `useTimeline` / a new `createPaginatedTagValueLoader` instance when the data isn't already in scope of one of the pre-wired loaders.

### Custom Event Kinds — Factory + Cast + Hook

For any project-specific kind, use the three-layer pattern: **Factory** in `src/factories/` (builds + signs), **Cast** in `src/casts/` (typed wrapper with `Symbol.for(...)`-cached getters), **Hook** in `src/hooks/` (subscribes and casts via `castTimelineStream`). **Never** manually parse `NostrEvent.tags` in hooks or components.

Don't reinvent — copy the closest existing example and adapt: `IssueFactory` + `Issue` + `useIssues`, or `PatchFactory` + `Patch` + `usePatchChain`, or `RepositoryFactory` + `Repository` + `useResolvedRepository`. Look up additional `applesauce-core/operations/...` and `EventCast` / `EventFactory` API in the Applesauce MCP.

### NIP-22 Comments (kind:1111)

Replies to non-kind-1 events (NIP-34 issues/patches, NIP-23 articles) use **kind:1111** with **uppercase** `E` / `P` tags for the thread root and lowercase `e` / `p` for the immediate parent. Load the **`nip22-comments`** skill for the tag layout and queries.

### NIP-19 Identifiers and Routing

Bech32 identifiers (`npub1`, `nprofile1`, `note1`, `nevent1`, `naddr1`) route at the URL **root** — `/:nip19` is handled by `src/pages/NIP19Page.tsx`, which branches on `nip19.decode().type`. **Never nest** under `/note/`, `/profile/`, etc.

- Filters only accept hex — always `nip19.decode()` before querying. For `naddr1`, decoded data is `{ kind, pubkey, identifier, relays? }` — **always include `pubkey` in `authors`** (see §"Repository authorization model"). For `nevent1`, decoded data is `{ id, author?, kind?, relays? }` — pass `relays` into your subscription as a hint.
- Treat `nsec1` and unknown prefixes as 404.
- Build with `nip19.npubEncode` / `noteEncode` / `neventEncode` / `nprofileEncode` / `naddrEncode`.
- **Route ordering matters.** Multi-segment routes (`/:npub/:repoId`, `/:npub/:repoId/issues/:issueId`) **must** appear above the catch-all `/:nip19` route — React Router matches top-to-bottom and stops at the first match.

### File Uploads

File uploads use Blossom via `useBlossomUpload` / `useBlossomFallback`.

### Authentication

`<LoginArea />` from `@/components/auth/LoginArea` provides the full login/signup UI (extension, nsec, NIP-46 bunker) and an account switcher when logged in. Drop it in your header. For programmatic flows use `useLoginActions` (`extension()`, `nsec()`, `bunker()`, `logout()`).

The active account is exposed via `useAccount()` (returns `{ pubkey, signer } | null`). The signer implements NIP-07 (`signEvent`, optional `nip04`, optional `nip44`).

## Routing

Routes live in `AppRouter.tsx`. To add one:

1. Create the page component in `src/pages/`.
2. Import it in `AppRouter.tsx`.
3. Place it **above** the `/:nip19` catch-all and the `*` 404 route.

The router auto-scrolls to top on navigation.

## Loading and Empty States

**Use skeletons** for structured content (feeds, profiles, forms). **Use spinners** only for buttons or short operations.

```tsx
<Card>
  <CardHeader>
    <div className="flex items-center space-x-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="space-y-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  </CardContent>
</Card>
```

For empty results, show a minimalist `border-dashed` card:

```tsx
<Card className="border-dashed">
  <CardContent className="py-12 px-8 text-center">
    <p className="text-muted-foreground max-w-sm mx-auto">
      No results found. Try checking your relay connections or wait a moment for
      content to load.
    </p>
  </CardContent>
</Card>
```

## Design Standards

Designs should be polished and production-ready. Concrete rules:

- **Responsive** down to ~360px; test mobile, tablet, desktop.
- **WCAG 2.1 AA**: ≥ 4.5:1 contrast for body text, ≥ 3:1 for large text and UI elements. Full keyboard nav, ARIA labels, visible `focus-visible` rings.
- **8px grid** (Tailwind's 4-based scale). Avoid one-off `p-[13px]`-style values.
- **Typography hierarchy**: ≥ 18px body, ≥ 40px primary headlines. Inter (already wired via `@fontsource-variable/inter`) is the default sans.
- **Depth**: soft shadows, gentle gradients, rounded corners (`rounded-lg` / `rounded-xl`). Avoid heavy drop shadows.
- **Motion**: lightweight, purposeful (hover, scroll reveals, transitions). Respect `prefers-reduced-motion` with `motion-safe:` / `motion-reduce:`.
- **Reusable components**: consistent variants and feedback states (`hover`, `focus-visible`, `active`, `disabled`, `aria-invalid`). Use `cn()` for conditional classes and `class-variance-authority` for variants — copy an existing `ui/` component as a template.
- **Custom over generic**: avoid template-looking headers — use layered visuals, subtle motion, brand colors. Generate custom images before reaching for stock.

For font installation, color-scheme changes, light/dark theming, and the `isolate` + negative-z-index gotcha, load the **`theming`** skill.

### Date Formatting

`date-fns` is already a project dependency. Nostr `created_at` is **seconds** — multiply by 1000 for `Date`.

```ts
import { formatDistanceToNow, format } from "date-fns";
formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });
format(new Date(event.created_at * 1000), "MMM d, yyyy 'at' h:mm a");
```

## Writing Tests vs. Running Tests

**Writing (creating new test files) — don't, unless asked.** Only create new tests when:

1. The user explicitly asks for tests.
2. The user describes a specific bug and asks for tests to diagnose it.
3. The user says a problem persists after you tried to fix it.

Never write tests because tool results show failures, because you think tests would be helpful, or because you added a feature.

**Running validation — let pre-commit do it.** The git pre-commit hook runs the full `pnpm pre-commit` script (tsc, eslint, prettier --write, vitest, build). Don't run those tools manually as part of "validating" your changes — commit and react to anything pre-commit rejects.

### Test Setup

Vitest + jsdom, with React Testing Library and jest-dom matchers. Mocked browser APIs: `matchMedia`, `scrollTo`, `IntersectionObserver`, `ResizeObserver`. Wrap components in `TestApp` (from `@/test/TestApp`) when rendering — it provides all required providers.

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestApp } from "@/test/TestApp";
import { MyComponent } from "./MyComponent";

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(
      <TestApp>
        <MyComponent />
      </TestApp>,
    );
    expect(screen.getByText("Expected text")).toBeInTheDocument();
  });
});
```

## Validating Your Changes

**Your task is finished when `git commit` succeeds.** The pre-commit hook handles type-checking, linting, formatting, tests, and build. If pre-commit rejects the commit, fix the reported error and commit again.

### Using Git

Use `git status` / `git diff` / `git log` to inspect state and learn project conventions. If you make a mistake, `git checkout` restores files. **Always commit when you are finished** — non-negotiable, every completed task ends with a commit.

## Specialized Skills

Load via the `skill` tool when the task matches:

- **`react-rxjs-observables`** — using `use$` correctly: factory pattern, dependency arrays, conditional observables, common mistakes.
- **`resilient-subscriptions`** — `resilientSubscription` / `resilientRequest` deep-dive: options, three query patterns, tag-filter casting, `mapEventsToTimeline` typing, reactive counts.
- **`nip22-comments`** — kind:1111 comment trees on non-kind-1 events; uppercase `E`/`P` vs lowercase `e`/`p`.
- **`theming`** — fonts (@fontsource), color schemes, light/dark, `isolate` + negative z-index.
- **`ngit`** — workflows for `nostr://` git remotes, ngit CLI, gitworkshop.dev PRs/issues. (Auto-loaded when working with nostr:// remotes.)

When the task is Applesauce API surface — looking up methods, models, casts, actions, loaders — **prefer the Applesauce MCP** over loading a skill.
