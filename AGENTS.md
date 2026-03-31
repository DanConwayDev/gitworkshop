# Project Overview

This project is a Nostr client application built with React 18.x, TailwindCSS 3.x, Vite, shadcn/ui, and Applesauce.

## Technology Stack

- **React 18.x**: Stable version of React with hooks, concurrent rendering, and improved performance
- **TailwindCSS 3.x**: Utility-first CSS framework for styling
- **Vite**: Fast build tool and development server
- **shadcn/ui**: Unstyled, accessible UI components built with Radix UI and Tailwind
- **Applesauce**: Production-ready Nostr SDK with reactive architecture (used in noStrudel)
- **RxJS**: Reactive programming with observables for state management
- **React Router**: For client-side routing with BrowserRouter and ScrollToTop functionality
- **TypeScript**: For type-safe JavaScript development

## Project Structure

- `/docs/`: Specialized documentation for implementation patterns and features
- `/src/services/`: Core applesauce services (EventStore, RelayPool, loaders, accounts, actions, state)
- `/src/components/`: UI components
  - `/src/components/ui/`: shadcn/ui components (48+ components available)
  - `/src/components/auth/`: Authentication-related components (LoginArea, LoginDialog, AccountSwitcher, SignupDialog)
- `/src/hooks/`: Custom hooks including:
  - `use$`: Subscribe to RxJS observables
  - `useEventStore`: Access global EventStore
  - `useAccount`: Get currently logged-in account
  - `useProfile`: Fetch user profile data by pubkey (uses ProfileModel)
  - `useTimeline`: Subscribe to timeline with configurable cast class (defaults to Note)
  - `useEvents`: Subscribe to raw NostrEvent[] feed (for events of different kinds)
  - `usePublish`: Publish events with EventTemplate
  - `useAction`: Execute pre-built actions (UpdateProfile, CreateNote, etc.)
  - `useTheme`: Theme management with RxJS observables
  - `useToast`: Toast notifications
  - `useLocalStorage`: Persistent local storage
  - `useLoggedInAccounts`: Manage multiple accounts
  - `useLoginActions`: Authentication actions (extension, nsec, bunker)
  - `useIsFollowing`: Check if the logged-in user follows a given pubkey (reactive, updates on follow/unfollow)
  - `useIsMobile`: Responsive design helper
- `/src/blueprints/`: Custom event blueprints for standardized event creation
- `/src/operations/`: Custom event operations for composable event building
- `/src/pages/`: Page components used by React Router (Index, NotFound)
- `/src/lib/`: Utility functions and shared logic
- `/src/types/`: TypeScript type definitions (NostrMetadata, window.nostr)
- `/src/test/`: Testing utilities including TestApp component
- `/public/`: Static assets
- `App.tsx`: Main app component with provider setup (**CRITICAL**: this file is **already configured** with `EventStoreProvider`, `AccountsProvider`, `UnheadProvider` and other important providers - **read this file before making changes**. Changes are usually not necessary unless adding new providers. Changing this file may break the application)
- `AppRouter.tsx`: React Router configuration

**CRITICAL**: Always read the files mentioned above before making changes, as they contain important setup and configuration for the application. Never directly write to these files without first reading their contents.

## UI Components

The project uses shadcn/ui components located in `@/components/ui`. These are unstyled, accessible components built with Radix UI and styled with Tailwind CSS. Available components include:

- **Accordion**: Vertically collapsing content panels
- **Alert**: Displays important messages to users
- **AlertDialog**: Modal dialog for critical actions requiring confirmation
- **AspectRatio**: Maintains consistent width-to-height ratio
- **Avatar**: Low-level primitive for profile pictures with fallback support. **Do not use `Avatar` directly to render another Nostr user's picture** — use `UserAvatar` (or `UserLink`) from `@/components/UserAvatar` instead. Those components automatically show the follow-indicator badge for users the current account follows, which helps distinguish known contacts from impersonators. Raw `Avatar` is only appropriate when rendering your _own_ account (e.g. `AccountSwitcher`, compose-box self-avatar) or non-user imagery.
- **Badge**: Small status descriptors for UI elements
- **Breadcrumb**: Navigation aid showing current location in hierarchy
- **Button**: Customizable button with multiple variants and sizes
- **Calendar**: Date picker component
- **Card**: Container with header, content, and footer sections
- **Carousel**: Slideshow for cycling through elements
- **Chart**: Data visualization component
- **Checkbox**: Selectable input element
- **Collapsible**: Toggle for showing/hiding content
- **Command**: Command palette for keyboard-first interfaces
- **ContextMenu**: Right-click menu component
- **Dialog**: Modal window overlay
- **Drawer**: Side-sliding panel (using vaul)
- **DropdownMenu**: Menu that appears from a trigger element
- **Form**: Form validation and submission handling
- **HoverCard**: Card that appears when hovering over an element
- **InputOTP**: One-time password input field
- **Input**: Text input field
- **Label**: Accessible form labels
- **Menubar**: Horizontal menu with dropdowns
- **NavigationMenu**: Accessible navigation component
- **Pagination**: Controls for navigating between pages
- **Popover**: Floating content triggered by a button
- **Progress**: Progress indicator
- **RadioGroup**: Group of radio inputs
- **Resizable**: Resizable panels and interfaces
- **ScrollArea**: Scrollable container with custom scrollbars
- **Select**: Dropdown selection component
- **Separator**: Visual divider between content
- **Sheet**: Side-anchored dialog component
- **Sidebar**: Navigation sidebar component
- **Skeleton**: Loading placeholder
- **Slider**: Input for selecting a value from a range
- **Switch**: Toggle switch control
- **Table**: Data table with headers and rows
- **Tabs**: Tabbed interface component
- **Textarea**: Multi-line text input
- **Toast**: Toast notification component
- **ToggleGroup**: Group of toggle buttons
- **Toggle**: Two-state button
- **Tooltip**: Informational text that appears on hover

These components follow a consistent pattern using React's `forwardRef` and use the `cn()` utility for class name merging. Many are built on Radix UI primitives for accessibility and customized with Tailwind CSS.

## Documentation

The project includes a **`docs/`** directory containing specialized documentation for specific implementation tasks. You are encouraged to add new documentation files to help future development.

- **`docs/AI_CHAT.md`**: Read when building any AI-powered chat interfaces, implementing streaming responses, or integrating with the Shakespeare API.

- **`docs/NOSTR_COMMENTS.md`**: Read when implementing comment systems, adding discussion features to posts/articles, or building community interaction features.

- **`docs/NOSTR_INFINITE_SCROLL.md`**: Read when building feed interfaces, implementing pagination for Nostr events, or creating social media-style infinite scroll experiences.

- **`docs/NOSTR_DIRECT_MESSAGES.md`**: Read when implementing direct messaging features, building chat interfaces, or working with encrypted peer-to-peer communication (NIP-04 and NIP-17).

- **`docs/RXJS_OBSERVABLES_IN_REACT.md`**: Read when working with RxJS observables in React components, using the `use$` hook, subscribing to Applesauce models/casts, or implementing reactive data flows.

## System Prompt Management

The AI assistant's behavior and knowledge is defined by the AGENTS.md file, which serves as the system prompt. To modify the assistant's instructions or add new project-specific guidelines:

1. Edit AGENTS.md directly
2. The changes take effect in the next session

## Applesauce MCP Server

An **Applesauce MCP server** is available at `https://mcp.applesauce.build/mcp` and is configured in this project. Use it extensively when working with Applesauce — it provides up-to-date documentation, method signatures, examples, and API references directly from the Applesauce source. Always prefer querying the MCP server over relying solely on the static documentation in this file, especially when:

- Looking up method signatures, types, or interfaces
- Finding the right class, hook, or utility for a task
- Checking what's available in a specific package
- Verifying correct usage patterns or options

## Nostr Protocol Integration

This project uses **Applesauce v5**, a production-ready Nostr SDK with a reactive architecture built on RxJS. Applesauce provides a complete solution for building Nostr clients with real-time updates, efficient caching, and a powerful cast system for working with events.

### Core Architecture

Applesauce follows a layered architecture:

1. **EventStore**: Central state container that stores all Nostr events in memory
2. **RelayPool**: Manages WebSocket connections to Nostr relays
3. **Loaders**: Automatically fetch missing events (replies, reactions, profiles, etc.)
4. **Models**: Reactive data models that update when events change (ProfileModel, ThreadModel, etc.)
5. **Casts**: Type-safe wrappers around events with computed properties (Note, User, Reaction, Zap)
6. **Actions**: Pre-built operations for common tasks (CreateNote, UpdateProfile, FollowUser)
7. **Accounts**: Multi-account management with various signer types

### Nostr Implementation Guidelines

- Always check the full list of existing NIPs before implementing any Nostr features to see what kinds are currently in use across all NIPs.
- If any existing kind or NIP might offer the required functionality, read the relevant NIPs to investigate thoroughly. Several NIPs may need to be read before making a decision.
- Only generate new kind numbers if no existing suitable kinds are found after comprehensive research.

Knowing when to create a new kind versus reusing an existing kind requires careful judgement. Introducing new kinds means the project won't be interoperable with existing clients. But deviating too far from the schema of a particular kind can cause different interoperability issues.

#### Choosing Between Existing NIPs and Custom Kinds

When implementing features that could use existing NIPs, follow this decision framework:

1. **Thorough NIP Review**: Before considering a new kind, always perform a comprehensive review of existing NIPs and their associated kinds. Get an overview of all NIPs, and then read specific NIPs and kind documentation to investigate any potentially relevant NIPs or kinds in detail. The goal is to find the closest existing solution.

2. **Prioritize Existing NIPs**: Always prefer extending or using existing NIPs over creating custom kinds, even if they require minor compromises in functionality.

3. **Interoperability vs. Perfect Fit**: Consider the trade-off between:
   - **Interoperability**: Using existing kinds means compatibility with other Nostr clients
   - **Perfect Schema**: Custom kinds allow perfect data modeling but create ecosystem fragmentation

4. **Extension Strategy**: When existing NIPs are close but not perfect:
   - Use the existing kind as the base
   - Add domain-specific tags for additional metadata
   - Document the extensions in `NIP.md`

5. **When to Generate Custom Kinds**:
   - No existing NIP covers the core functionality
   - The data structure is fundamentally different from existing patterns
   - The use case requires different storage characteristics (regular vs replaceable vs addressable)
   - If you have a tool available to generate a kind, you **MUST** call the tool to generate a new kind rather than picking an arbitrary number

6. **Custom Kind Publishing**: When publishing events with custom generated kinds, always include a NIP-31 "alt" tag with a human-readable description of the event's purpose.

**Example Decision Process**:

```
Need: Equipment marketplace for farmers
Options:
1. NIP-15 (Marketplace) - Too structured for peer-to-peer sales
2. NIP-99 (Classified Listings) - Good fit, can extend with farming tags
3. Custom kind - Perfect fit but no interoperability

Decision: Use NIP-99 + farming-specific tags for best balance
```

#### Tag Design Principles

When designing tags for Nostr events, follow these principles:

1. **Kind vs Tags Separation**:
   - **Kind** = Schema/structure (how the data is organized)
   - **Tags** = Semantics/categories (what the data represents)
   - Don't create different kinds for the same data structure

2. **Use Single-Letter Tags for Categories**:
   - **Relays only index single-letter tags** for efficient querying
   - Use `t` tags for categorization, not custom multi-letter tags
   - Multiple `t` tags allow items to belong to multiple categories

3. **Relay-Level Filtering**:
   - Design tags to enable efficient relay-level filtering with `#t: ["category"]`
   - Avoid client-side filtering when relay-level filtering is possible
   - Consider query patterns when designing tag structure

4. **Tag Examples**:

   ```json
   // ❌ Wrong: Multi-letter tag, not queryable at relay level
   ["product_type", "electronics"]

   // ✅ Correct: Single-letter tag, relay-indexed and queryable
   ["t", "electronics"]
   ["t", "smartphone"]
   ["t", "android"]
   ```

5. **Querying Best Practices**:

   ```typescript
   // ❌ Inefficient: Get all events, filter in JavaScript
   const events = store.getEvents({ kinds: [30402] });
   const filtered = events.filter((e) =>
     hasTag(e, "product_type", "electronics"),
   );

   // ✅ Efficient: Filter at relay level
   pool.subscription(relays, [{ kinds: [30402], "#t": ["electronics"] }]);
   ```

#### `t` Tag Filtering for Community-Specific Content

For applications focused on a specific community or niche, you can use `t` tags to filter events for the target audience.

**When to Use:**

- ✅ Community apps: "farmers" → `t: "farming"`, "Poland" → `t: "poland"`
- ❌ Generic platforms: Twitter clones, general Nostr clients

**Implementation:**

```typescript
// Publishing with community tag
const { publishEvent } = usePublish();
await publishEvent({
  kind: 1,
  content: data.content,
  tags: [["t", "farming"]],
});

// Querying community content
const notes = useTimeline(
  ["wss://relay.damus.io"],
  [{ kinds: [1], "#t": ["farming"], limit: 20 }],
);
```

### Kind Ranges

An event's kind number determines the event's behavior and storage characteristics:

- **Regular Events** (1000 ≤ kind < 10000): Expected to be stored by relays permanently. Used for persistent content like notes, articles, etc.
- **Replaceable Events** (10000 ≤ kind < 20000): Only the latest event per pubkey+kind combination is stored. Used for profile metadata, contact lists, etc.
- **Addressable Events** (30000 ≤ kind < 40000): Identified by pubkey+kind+d-tag combination, only latest per combination is stored. Used for articles, long-form content, etc.

Kinds below 1000 are considered "legacy" kinds, and may have different storage characteristics based on their kind definition. For example, kind 1 is regular, while kind 3 is replaceable.

### Content Field Design Principles

When designing new event kinds, the `content` field should be used for semantically important data that doesn't need to be queried by relays. **Structured JSON data generally shouldn't go in the content field** (kind 0 being an early exception).

#### Guidelines

- **Use content for**: Large text, freeform human-readable content, or existing industry-standard JSON formats (Tiled maps, FHIR, GeoJSON)
- **Use tags for**: Queryable metadata, structured data, anything that needs relay-level filtering
- **Empty content is valid**: Many events need only tags with `content: ""`
- **Relays only index tags**: If you need to filter by a field, it must be a tag

#### Example

**✅ Good - queryable data in tags:**

```json
{
  "kind": 30402,
  "content": "",
  "tags": [
    ["d", "product-123"],
    ["title", "Camera"],
    ["price", "250"],
    ["t", "photography"]
  ]
}
```

**❌ Bad - structured data in content:**

```json
{
  "kind": 30402,
  "content": "{\"title\":\"Camera\",\"price\":250,\"category\":\"photo\"}",
  "tags": [["d", "product-123"]]
}
```

### NIP.md

The file `NIP.md` is used by this project to define a custom Nostr protocol document. If the file doesn't exist, it means this project doesn't have any custom kinds associated with it.

Whenever new kinds are generated, the `NIP.md` file in the project must be created or updated to document the custom event schema. Whenever the schema of one of these custom events changes, `NIP.md` must also be updated accordingly.

### Core Hooks

Applesauce provides several React hooks for building Nostr applications. All hooks are re-exported from `/src/hooks/` for convenience.

#### `use$` - Subscribe to Observables

The `use$` hook subscribes to RxJS observables and returns the current value. It automatically unsubscribes when the component unmounts.

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { ProfileModel } from "applesauce-core/models";

function UserProfile({ pubkey }: { pubkey: string }) {
  const store = useEventStore();
  const profile = use$(
    () => store.model(ProfileModel, pubkey),
    [pubkey, store],
  );

  return <div>{profile?.name ?? "Anonymous"}</div>;
}
```

**Key Features:**

- Automatically handles subscription lifecycle
- Re-subscribes when dependencies change
- Returns `undefined` while loading
- Type-safe with TypeScript

#### `useEventStore` - Access the Global EventStore

The `useEventStore` hook returns the global EventStore instance from context.

```tsx
import { useEventStore } from "@/hooks/useEventStore";

function MyComponent() {
  const store = useEventStore();

  // Query events from the store
  const events = store.getEvents({ kinds: [1], limit: 20 });

  // Add events to the store
  store.add(event);

  return <div>Total events: {store.count()}</div>;
}
```

**EventStore Methods:**

- `add(event)`: Add event to store
- `getEvents(filter)`: Query events by filter
- `getEvent(id)`: Get single event by ID
- `timeline(filters)`: Get observable timeline
- `model(ModelClass, ...args)`: Create reactive model
- `count()`: Get total event count
- `clear()`: Clear all events

#### `useAccount` - Get Current Account

The `useAccount` hook returns the currently logged-in account or `null`.

```tsx
import { useAccount } from "@/hooks/useAccount";

function MyComponent() {
  const account = useAccount();

  if (!account) {
    return <LoginPrompt />;
  }

  return (
    <div>
      <p>Logged in as {account.pubkey}</p>
      <button onClick={() => account.signer.signEvent(template)}>
        Sign Event
      </button>
    </div>
  );
}
```

**Account Properties:**

- `pubkey`: User's public key (hex)
- `signer`: NIP-07 compatible signer for signing/encrypting

**Related Hook:**

- `useIsLoggedIn()`: Returns boolean instead of account object

#### `useUser` - Get User Cast (Recommended)

The `useUser` hook creates a User cast that provides reactive access to profile, contacts, and mailboxes.

```tsx
import { useUser } from "@/hooks/useUser";
import { use$ } from "@/hooks/use$";

function UserCard({ pubkey }: { pubkey: string }) {
  const user = useUser(pubkey);
  const profile = use$(user?.profile$);
  const contacts = use$(user?.contacts$);
  const outboxes = use$(user?.outboxes$);

  return (
    <div>
      <img src={profile?.picture} alt={profile?.name} />
      <h3>{profile?.displayName ?? profile?.name ?? "Anonymous"}</h3>
      <p>{profile?.about}</p>
      <p>Following {contacts?.length ?? 0} users</p>
      <p>Publishing to {outboxes?.length ?? 0} relays</p>
    </div>
  );
}
```

**User Cast Properties:**

- `profile$`: Observable<Profile> - User metadata (kind 0)
- `contacts$`: Observable<User[]> - Followed users (kind 3)
- `followers$`: Observable<User[]> - Users following this user
- `inboxes$`: Observable<string[]> - NIP-65 read relays
- `outboxes$`: Observable<string[]> - NIP-65 write relays
- `mutes$`: Observable<User[]> - Muted users

**Profile Fields (from Profile observable):**

- `name`: Display name
- `displayName`: Alternative display name
- `picture`: Avatar URL
- `banner`: Banner image URL
- `about`: Bio/description
- `nip05Verified`: Verified Nostr address
- `lud06`/`lud16`: Lightning addresses
- `website`: Personal website

**Related Hooks:**

- `useMyUser()`: Get current user's own User cast
- `useProfile(pubkey)`: Shortcut to get just the profile (uses User cast internally)
- `useMyProfile()`: Get current user's own profile

#### `useTimeline` - Subscribe to Event Timelines

The `useTimeline` hook subscribes to a live timeline of events from relays. Events are cast using the provided cast class (defaults to `Note`). Events that fail to cast (e.g. wrong kind) are silently dropped.

```tsx
import { useTimeline } from "@/hooks/useTimeline";
import { Note, Article } from "applesauce-common/casts";

// Default: kind:1 text notes
function Timeline() {
  const notes = useTimeline(
    ["wss://relay.damus.io"],
    [{ kinds: [1], limit: 20 }],
  );

  if (!notes) return <Loading />;

  return (
    <div>
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

// Custom cast: long-form articles
function ArticleFeed() {
  const articles = useTimeline(
    ["wss://relay.damus.io"],
    [{ kinds: [30023], limit: 20 }],
    Article,
  );

  if (!articles) return <Loading />;
  return articles.map((a) => <ArticleCard key={a.id} article={a} />);
}
```

**How it works:**

1. Queries relays with filters
2. Adds events to EventStore
3. Casts events using the provided cast class (silently drops events that fail to cast)
4. Updates automatically when events change

**Related Hook:**

- `useLocalTimeline(filters, castClass?)`: Query only from EventStore (no relays)

#### `useEvents` - Raw Event Feed

Use `useEvents` when you need raw `NostrEvent[]` without any cast overhead — useful when no appropriate cast class exists or when you want to handle the raw event data directly.

```tsx
import { useEvents } from "@/hooks/useEvents";
import type { Filter } from "applesauce-core/helpers";

// NIP-34 git issues for a repository
function IssueList({ repoCoord }: { repoCoord: string }) {
  // Tag filters not in the base Filter type must be cast — see Tag Filters section
  const filter = { kinds: [1621], "#a": [repoCoord] } as Filter;
  const events = useEvents(["wss://relay.damus.io"], [filter]);

  if (!events) return <Skeleton />;

  return (
    <ul>
      {events.map((e) => (
        <li key={e.id}>
          {e.tags.find(([t]) => t === "subject")?.[1] ?? "(no subject)"}
        </li>
      ))}
    </ul>
  );
}
```

**Related Hook:**

- `useLocalEvents(filters)`: Query only from EventStore (no relays)

#### `usePublish` - Publish Events

The `usePublish` hook provides a function to publish Nostr events. It automatically adds a "client" tag and handles signing.

```tsx
import { usePublish } from "@/hooks/usePublish";

function PostForm() {
  const { publishEvent, isPending } = usePublish();

  const handleSubmit = async () => {
    await publishEvent({
      kind: 1,
      content: "Hello Nostr!",
      tags: [],
    });
  };

  return (
    <button onClick={handleSubmit} disabled={isPending}>
      Post
    </button>
  );
}
```

**Features:**

- Automatically signs with user's signer
- Adds "client" tag (hostname on HTTPS)
- Publishes to configured relays
- Adds event to local EventStore
- Returns published event

**Backward Compatibility:**

- `useNostrPublish()` is an alias for `usePublish()`

#### `useAction` - Execute Pre-built Actions

The `useAction` hook executes pre-built Nostr actions from the Actions library.

```tsx
import { useAction } from "@/hooks/useAction";
import { CreateNote, FollowUser } from "applesauce-actions/actions";

function PostForm() {
  const createNote = useAction(CreateNote);
  const [content, setContent] = useState("");

  const handleSubmit = async () => {
    await createNote(content);
    setContent("");
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} />
      <button type="submit">Post</button>
    </form>
  );
}

function FollowButton({ pubkey }: { pubkey: string }) {
  const followUser = useAction(FollowUser);
  return <button onClick={() => followUser(pubkey)}>Follow</button>;
}
```

**Available Actions:**

- `CreateNote`: Publish text note (kind 1)
- `DeleteEvent`: Delete an event (kind 5)
- `UpdateProfile`: Update profile metadata (kind 0)
- `UpdateContacts`: Update contact list (kind 3)
- `FollowUser`/`UnfollowUser`: Manage follows
- `MuteUser`/`UnmuteUser`: Manage mutes
- `CreateBookmark`/`CreatePin`: Manage bookmarks/pins
- And many more in `applesauce-actions/actions`

### Querying Events from Relays

There are three main patterns for querying events:

#### Pattern 1: Using `useTimeline` Hook (Recommended)

Best for feeds and timelines. Automatically handles subscriptions and casts to Note objects.

```tsx
import { useTimeline } from "@/hooks/useTimeline";

function Feed() {
  const notes = useTimeline(
    ["wss://relay.damus.io"],
    [{ kinds: [1], limit: 50 }],
  );

  if (!notes) return <Skeleton />;

  return notes.map((note) => <NoteCard key={note.id} note={note} />);
}
```

#### Pattern 2: Direct RelayPool Queries

For custom queries with more control. Use with `use$` for reactivity.

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { pool } from "@/services/pool";
import {
  onlyEvents,
  mapEventsToStore,
  mapEventsToTimeline,
} from "applesauce-relay";

function CustomFeed() {
  const store = useEventStore();

  const events = use$(
    () =>
      pool
        .subscription(
          ["wss://relay.damus.io"],
          [{ kinds: [1], authors: [pubkey] }],
        )
        .pipe(
          onlyEvents(), // Filter out EOSE messages
          mapEventsToStore(store), // Add to store
          mapEventsToTimeline(), // Collect into array
        ),
    [pubkey, store],
  );

  return events?.map((e) => <div key={e.id}>{e.content}</div>);
}
```

#### Pattern 3: EventStore Queries

For querying events already in the store (no relay queries).

```tsx
import { useEventStore } from "@/hooks/useEventStore";

function LocalEvents() {
  const store = useEventStore();
  const events = store.getEvents({ kinds: [1], limit: 20 });

  return events.map((e) => <div key={e.id}>{e.content}</div>);
}
```

### Tag Filters in Relay Queries

The base `Filter` type from `applesauce-core/helpers` does not include every possible tag filter. When filtering by tags like `#a`, `#E` (uppercase), `#t`, or any custom tag, cast the filter object:

```typescript
import type { Filter } from "applesauce-core/helpers";

// ✅ Cast required for tag filters not in the base type
const filter = { kinds: [1621], "#a": [repoCoord] } as Filter;
const filter2 = { kinds: [1111], "#E": [issueId] } as Filter;
const filter3 = { kinds: [1], "#t": ["farming"] } as Filter;
```

**Note on uppercase vs lowercase tag filters:**

- Lowercase single-letter tags (`#e`, `#p`, `#a`, `#t`) are indexed by relays
- Uppercase tags (`#E`, `#P`, `#A`) are used by NIP-22 (comments) to reference the **root** of a thread, as opposed to the immediate reply parent
- Always check the NIP spec to know which case a tag uses

### `mapEventsToTimeline()` Return Type

When building custom observable pipelines with `mapEventsToTimeline()`, TypeScript infers the return type as `unknown`. Cast explicitly to `NostrEvent[]`:

```typescript
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

const events = use$(
  () =>
    pool
      .subscription(relays, filters)
      .pipe(
        onlyEvents(),
        mapEventsToStore(store),
        mapEventsToTimeline(),
      ) as unknown as Observable<NostrEvent[]>,
  [relayKey, filterKey, store],
);
// events is now NostrEvent[] | undefined — no further cast needed
```

### `use$` with Conditional / Optional Observables

When the observable factory depends on optional parameters, return `undefined` early rather than conditionally calling hooks. The dependency array must remain stable:

```typescript
// ✅ Correct: early return inside factory, stable dep array
const events = use$(
  () => {
    if (!repoCoord) return undefined; // use$ handles undefined gracefully
    return pool.subscription(relays, [{ kinds: [1621], "#a": [repoCoord] } as Filter]).pipe(
      onlyEvents(),
      mapEventsToStore(store),
      mapEventsToTimeline(),
    ) as unknown as Observable<NostrEvent[]>;
  },
  [repoCoord, relayKey, store], // repoCoord in deps — re-subscribes when it changes
);

// ❌ Wrong: conditional hook call causes React rules-of-hooks violation
if (!repoCoord) return null;
const events = use$(() => pool.subscription(...), [store]);
```

**Key rule**: always include every variable the factory closes over in the dependency array, even optional ones. Missing deps cause stale subscriptions; extra deps only cause harmless re-subscriptions.

### Reactive Counts from the EventStore

To reactively display a count of events matching a filter (e.g. comment count, issue count), subscribe to `store.timeline()` and map to `.length`:

```typescript
import { map } from "rxjs/operators";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import type { Filter } from "applesauce-core/helpers";

function useEventCount(filters: Filter[]): number {
  const store = useEventStore();
  const filterKey = JSON.stringify(filters);

  return (
    use$(
      () => store.timeline(filters).pipe(map((events) => events.length)),
      [filterKey, store],
    ) ?? 0
  );
}

// Usage: comment count badge on an issue
function IssueRow({ issue }: { issue: NostrEvent }) {
  const filter = { kinds: [1111], "#E": [issue.id] } as Filter;
  const commentCount = useEventCount([filter]);

  return (
    <div>
      <span>{issue.tags.find(([t]) => t === "subject")?.[1]}</span>
      <Badge>{commentCount}</Badge>
    </div>
  );
}
```

### NIP-22 Comments (kind:1111)

Replies to non-kind-1 events (NIP-34 git issues/patches, NIP-23 articles, etc.) use **kind:1111** (NIP-22), not kind:1 replies. NIP-22 uses **uppercase** `E` and `P` tags to reference the thread root, and lowercase `e`/`p` for the immediate reply parent.

```typescript
// Querying comments on a NIP-34 issue
const filter = { kinds: [1111], "#E": [issueEventId] } as Filter;

// Publishing a comment on an issue
await publishEvent({
  kind: 1111,
  content: "This looks like a bug in the parser.",
  tags: [
    ["E", issueEventId, relayHint, "root"], // uppercase = root of thread
    ["P", issueAuthorPubkey, relayHint], // uppercase = root author
    ["e", issueEventId, relayHint, "reply"], // lowercase = immediate parent
    ["p", issueAuthorPubkey], // lowercase = immediate parent author
    ["k", "1621"], // kind of the root event
  ],
});
```

**Summary of NIP-22 tag conventions:**

| Tag | Case      | Meaning                                   |
| --- | --------- | ----------------------------------------- |
| `E` | Uppercase | Root event of the thread                  |
| `P` | Uppercase | Author of the root event                  |
| `e` | Lowercase | Immediate reply parent event              |
| `p` | Lowercase | Author of the immediate reply parent      |
| `k` | Lowercase | Kind number of the root event (as string) |

### Cast System

Applesauce's cast system wraps raw Nostr events in type-safe classes with computed properties and reactive behavior. Casts automatically update when related events change.

#### Note Cast

The `Note` cast represents kind 1 text notes with helpful properties and methods.

```tsx
import { Note } from "applesauce-common/casts";
import { use$ } from "@/hooks/use$";

function NoteCard({ note }: { note: Note }) {
  // Reactive properties - update automatically
  const author = use$(() => note.author); // User cast
  const replyCount = use$(() => note.replies?.count); // Number of replies
  const reactions = use$(() => note.reactions); // Reaction casts array
  const replyTo = use$(() => note.replyTo); // Parent note if this is a reply

  return (
    <div>
      <div>{author?.name ?? "Anonymous"}</div>
      <p>{note.content}</p>
      <div>Replies: {replyCount ?? 0}</div>
    </div>
  );
}
```

**Note Properties:**

- `id`: Event ID
- `content`: Note content
- `author`: Observable<User> - Author profile
- `replies`: Observable<CommentsModel> - Replies
- `reactions`: Observable<Reaction[]> - Reactions
- `zaps`: Observable<Zap[]> - Zaps
- `replyTo`: Observable<Note> - Parent note
- `mentions`: Observable<User[]> - Mentioned users

#### User Cast

The `User` cast represents user profiles with metadata.

```tsx
import { User } from "applesauce-common/casts";
import { use$ } from "@/hooks/use$";

function UserCard({ user }: { user: User }) {
  const profile = use$(() => user.profile); // ProfileContent

  return (
    <div>
      <img src={profile?.picture} />
      <h3>{profile?.name ?? user.pubkey.slice(0, 8)}</h3>
      <p>{profile?.about}</p>
    </div>
  );
}
```

**User Properties:**

- `pubkey`: Public key
- `profile`: Observable<ProfileContent> - Kind 0 metadata
- `follows`: Observable<string[]> - Followed pubkeys
- `followers`: Observable<string[]> - Follower pubkeys

#### Reaction Cast

The `Reaction` cast represents kind 7 reactions.

```tsx
import { Reaction } from "applesauce-common/casts";
import { use$ } from "@/hooks/use$";

function ReactionsList({ reactions }: { reactions: Reaction[] }) {
  return (
    <div>
      {reactions.map((reaction) => {
        const author = use$(() => reaction.author);
        return (
          <span key={reaction.id}>
            {reaction.emoji} by {author?.name}
          </span>
        );
      })}
    </div>
  );
}
```

**Reaction Properties:**

- `emoji`: Reaction emoji (e.g., "❤️", "+", "-")
- `target`: Observable<Note> - Target event
- `author`: Observable<User> - Author of reaction

#### Zap Cast

The `Zap` cast represents NIP-57 lightning payments.

```tsx
import { Zap } from "applesauce-common/casts";
import { use$ } from "@/hooks/use$";

function ZapsList({ zaps }: { zaps: Zap[] }) {
  return (
    <div>
      {zaps.map((zap) => {
        const sender = use$(() => zap.sender);
        return (
          <div key={zap.id}>
            {sender?.name} zapped {zap.amount} sats
            {zap.comment && <p>{zap.comment}</p>}
          </div>
        );
      })}
    </div>
  );
}
```

**Zap Properties:**

- `amount`: Amount in sats
- `comment`: Optional zap comment
- `sender`: Observable<User> - Sender
- `target`: Observable<Note> - Target event

### Models

Applesauce Models are reactive data structures that automatically update when events change. Models are more powerful than casts and handle complex relationships.

#### ProfileModel

Fetches and tracks user profile metadata.

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { ProfileModel } from "applesauce-core/models";

function UserProfile({ pubkey }: { pubkey: string }) {
  const store = useEventStore();
  const profile = use$(
    () => store.model(ProfileModel, pubkey),
    [pubkey, store],
  );

  return (
    <div>
      <img src={profile?.picture} />
      <h2>{profile?.name}</h2>
      <p>{profile?.about}</p>
    </div>
  );
}
```

#### ThreadModel

Manages threaded conversations with replies.

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { ThreadModel } from "applesauce-core/models";

function ThreadView({ rootId }: { rootId: string }) {
  const store = useEventStore();
  const thread = use$(() => store.model(ThreadModel, rootId), [rootId, store]);

  return (
    <div>
      <h3>Thread with {thread?.replies.length} replies</h3>
      {thread?.replies.map((reply) => (
        <div key={reply.id}>{reply.content}</div>
      ))}
    </div>
  );
}
```

#### CommentsModel

Tracks comments/replies for an event.

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { CommentsModel } from "applesauce-core/models";

function CommentsList({ eventId }: { eventId: string }) {
  const store = useEventStore();
  const comments = use$(
    () => store.model(CommentsModel, eventId),
    [eventId, store],
  );

  return (
    <div>
      <h4>{comments?.count} comments</h4>
      {comments?.comments.map((comment) => (
        <div key={comment.id}>{comment.content}</div>
      ))}
    </div>
  );
}
```

#### ZapsModel

Tracks zaps for an event.

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { ZapsModel } from "applesauce-core/models";

function ZapsDisplay({ eventId }: { eventId: string }) {
  const store = useEventStore();
  const zapsModel = use$(
    () => store.model(ZapsModel, eventId),
    [eventId, store],
  );

  const totalAmount =
    zapsModel?.zaps.reduce((sum, zap) => sum + zap.amount, 0) ?? 0;

  return (
    <div>
      <p>Total zapped: {totalAmount} sats</p>
    </div>
  );
}
```

### Publishing Events

There are three patterns for publishing events:

#### Pattern 1: Using `usePublish` Hook (Recommended)

Best for simple event publishing.

```tsx
import { usePublish } from "@/hooks/usePublish";

function CreatePost() {
  const { publishEvent, isPending } = usePublish();

  const handleSubmit = async (content: string) => {
    await publishEvent({
      kind: 1,
      content,
      tags: [],
    });
  };

  return (
    <button onClick={() => handleSubmit("Hello!")} disabled={isPending}>
      Post
    </button>
  );
}
```

#### Pattern 2: Using Actions (For Complex Operations)

Best for pre-built operations like following users, updating profile, etc.

```tsx
import { useAction } from "@/hooks/useAction";
import { UpdateProfile } from "applesauce-actions/actions";

function EditProfile() {
  const updateProfile = useAction(UpdateProfile);

  const handleSave = async (profile: { name: string; about: string }) => {
    await updateProfile(profile);
  };

  return (
    <button onClick={() => handleSave({ name: "Alice", about: "Developer" })}>
      Save
    </button>
  );
}
```

#### Pattern 3: Direct Publishing with `publish` Function

For maximum control or custom publishing logic.

```tsx
import { publish } from "@/services/pool";
import { useAccount } from "@/hooks/useAccount";

function CustomPublish() {
  const account = useAccount();

  const handlePublish = async () => {
    const template = {
      kind: 1,
      content: "Hello Nostr!",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const signedEvent = await account!.signer.signEvent(template);
    await publish(signedEvent);
  };

  return <button onClick={handlePublish}>Publish</button>;
}
```

### Custom Event Kinds — The Full Applesauce Pattern

When working with a custom or domain-specific Nostr event kind, follow this four-layer pattern. **Do not** manually parse raw `NostrEvent` objects in hooks or components — use the cast system instead.

The four layers are:

1. **Operations** (`src/operations/`) — composable tag/content setters
2. **Blueprint** (`src/blueprints/`) — combines operations into a reusable event template
3. **Cast class** — typed wrapper around a raw event with reactive observables
4. **Hook** — subscribes to the EventStore and returns cast instances

#### Layer 1: Custom Operations (`src/operations/`)

Operations are pure functions that transform an `EventTemplate`. Put domain-specific ones in `src/operations/`.

```typescript
// src/operations/issue.ts
import type { EventOperation } from "applesauce-core/event-factory";
import { modifyPublicTags } from "applesauce-core/operations";
import { setSingletonTag } from "applesauce-core/operations";

/** Set the subject/title of an issue */
export function setSubject(subject: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["subject", subject]));
}

/** Tag this issue as belonging to a repository coordinate */
export function addRepositoryTag(repoCoord: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["a", repoCoord]]);
}

/** Add a label tag */
export function addLabel(label: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["t", label]]);
}
```

#### Layer 2: Blueprint (`src/blueprints/`)

A blueprint is a function that returns a call to `blueprint()` from `applesauce-core/event-factory`. It wires up the kind number and operations.

```typescript
// src/blueprints/issue.ts
import { blueprint } from "applesauce-core/event-factory";
import { setContent, includeAltTag } from "applesauce-core/operations";
import { setSubject, addRepositoryTag, addLabel } from "@/operations/issue";

export const ISSUE_KIND = 1621; // NIP-34

export interface IssueOptions {
  labels?: string[];
}

/** Blueprint for creating a NIP-34 git issue (kind 1621) */
export function IssueBlueprint(
  repoCoord: string,
  subject: string,
  content: string,
  options?: IssueOptions,
) {
  return blueprint(
    ISSUE_KIND,
    setSubject(subject),
    setContent(content),
    addRepositoryTag(repoCoord),
    includeAltTag(`Git issue: ${subject}`),
    ...(options?.labels ?? []).map(addLabel),
  );
}
```

**Using the blueprint to publish:**

```typescript
import { factory } from "@/services/actions";
import { publish } from "@/services/nostr";
import { IssueBlueprint } from "@/blueprints/issue";

// In a React component or hook:
const event = await factory.create(IssueBlueprint, repoCoord, subject, content);
const signed = await factory.sign(event);
await publish(signed);

// Or with the usePublish hook for simple cases:
const { publishEvent } = usePublish();
// usePublish doesn't use blueprints — use factory.create + publish for custom kinds
```

#### Layer 3: Cast Class

A cast class extends `EventCast` and provides typed, memoized access to event data. Use `getOrComputeCachedValue` with a `Symbol` key to avoid re-parsing on every render.

```typescript
// src/casts/Issue.ts
import { EventCast, CastRefEventStore } from "applesauce-common/casts";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import {
  getTagValue,
  KnownEvent,
  NostrEvent,
} from "applesauce-core/helpers/event";

export const ISSUE_KIND = 1621;
type IssueEvent = KnownEvent<typeof ISSUE_KIND>;

// Cache symbols — one per computed property
const SubjectSymbol = Symbol.for("issue-subject");
const LabelsSymbol = Symbol.for("issue-labels");
const RepoCoordSymbol = Symbol.for("issue-repo-coord");

/** Validate that a raw event is a well-formed issue */
export function isValidIssue(event: NostrEvent): event is IssueEvent {
  return (
    event.kind === ISSUE_KIND &&
    !!getTagValue(event, "subject") &&
    !!event.tags.find(([t]) => t === "a")
  );
}

export class Issue extends EventCast<IssueEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidIssue(event)) throw new Error("Invalid issue event");
    super(event, store);
  }

  get subject(): string {
    return getOrComputeCachedValue(
      this.event,
      SubjectSymbol,
      () => getTagValue(this.event, "subject")!,
    );
  }

  get repoCoord(): string {
    return getOrComputeCachedValue(
      this.event,
      RepoCoordSymbol,
      () => this.event.tags.find(([t]) => t === "a")?.[1]!,
    );
  }

  get labels(): string[] {
    return getOrComputeCachedValue(this.event, LabelsSymbol, () =>
      this.event.tags.filter(([t]) => t === "t").map(([, v]) => v),
    );
  }

  // Reactive observable: author profile via base EventCast
  // Use: use$(issue.author.profile$) in components
}
```

#### Layer 4: Hook

Use `castTimelineStream` in the observable pipeline so events are automatically cast and invalid events are silently dropped.

```typescript
// src/hooks/useIssues.ts
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { pool } from "@/services/nostr";
import { castTimelineStream } from "applesauce-common/observable";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { Issue, ISSUE_KIND } from "@/casts/Issue";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

const RELAYS = ["wss://relay.damus.io"];

export function useIssues(repoCoord: string | undefined): Issue[] | undefined {
  const store = useEventStore();

  // Subscribe to relay and cast events — no manual parsing needed
  use$(() => {
    if (!repoCoord) return undefined;
    const filter = { kinds: [ISSUE_KIND], "#a": [repoCoord] } as Filter;
    return pool
      .req(RELAYS, [filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [repoCoord, store]);

  // Read from store and cast to Issue instances
  return use$(() => {
    if (!repoCoord) return undefined;
    const filter = { kinds: [ISSUE_KIND], "#a": [repoCoord] } as Filter;
    return store
      .timeline([filter])
      .pipe(castTimelineStream(Issue, store)) as unknown as Observable<Issue[]>;
  }, [repoCoord, store]);
}
```

**Key differences from the anti-pattern:**

| Anti-pattern (avoid)                      | Correct pattern                                               |
| ----------------------------------------- | ------------------------------------------------------------- |
| `parseIssue(ev)` — manual parsing in hook | `castTimelineStream(Issue, store)` — cast in pipeline         |
| `useMemo` to transform raw events         | Cast class properties are already memoized with `Symbol` keys |
| Separate status map built in hook         | Status logic belongs in the cast class or a related model     |
| `NostrEvent[]` typed return               | `Issue[]` typed return — full type safety                     |
| Two `use$` calls + one `useMemo`          | Two `use$` calls (fetch + subscribe) — no `useMemo` needed    |

#### Using the Cast in Components

```tsx
import { use$ } from "@/hooks/use$";
import { useIssues } from "@/hooks/useIssues";

function IssueList({ repoCoord }: { repoCoord: string }) {
  const issues = useIssues(repoCoord);

  if (!issues) return <Skeleton />;

  return (
    <ul>
      {issues.map((issue) => (
        <IssueRow key={issue.id} issue={issue} />
      ))}
    </ul>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  // Reactive profile from base EventCast — no extra hook needed
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

#### Where Files Live

| Layer        | Directory         | Example file              |
| ------------ | ----------------- | ------------------------- |
| Operations   | `src/operations/` | `src/operations/issue.ts` |
| Blueprints   | `src/blueprints/` | `src/blueprints/issue.ts` |
| Cast classes | `src/casts/`      | `src/casts/Issue.ts`      |
| Hooks        | `src/hooks/`      | `src/hooks/useIssues.ts`  |

> **Note**: The `src/casts/` directory does not exist by default — create it when you add your first custom cast class.

### Loaders and Infinite Scroll

Applesauce provides loaders for implementing infinite scroll and pagination. See **`docs/NOSTR_INFINITE_SCROLL.md`** for complete implementation guide.

**Key Concepts:**

- **createTimelineLoader**: For paginated feeds/timelines
- **createEventLoader**: Automatically loads missing events
- **addressLoader**: For addressable events (kind 30000-39999)
- **reactionsLoader**: For loading reactions

**Example:**

```tsx
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { pool } from "@/services/pool";
import { eventStore } from "@/services/stores";

const loader = createTimelineLoader(pool, {
  eventStore,
  relays: ["wss://relay.damus.io"],
  filters: [{ kinds: [1], limit: 20 }],
});

// Load more events
await loader.loadMore();
```

### Authentication

#### LoginArea Component

The `LoginArea` component provides complete login/signup UI.

```tsx
import { LoginArea } from "@/components/auth/LoginArea";

function Header() {
  return (
    <header>
      <h1>My Nostr App</h1>
      <LoginArea className="max-w-60" />
    </header>
  );
}
```

**Features:**

- Shows "Log in" and "Sign up" buttons when logged out
- Shows account switcher when logged in
- Handles multiple accounts
- Supports NIP-07 extension, nsec, and bunker logins

#### useLoginActions Hook

For custom login flows, use `useLoginActions` to access login methods.

```tsx
import { useLoginActions } from "@/hooks/useLoginActions";

function CustomLogin() {
  const { extension, nsec, bunker, logout } = useLoginActions();

  const handleExtensionLogin = async () => {
    try {
      await extension();
      console.log("Logged in with extension");
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return <button onClick={handleExtensionLogin}>Login with Extension</button>;
}
```

**Available Methods:**

- `extension()`: Login with NIP-07 browser extension
- `nsec(nsecString)`: Login with secret key
- `bunker(bunkerUri)`: Login with NIP-46 remote signer
- `logout()`: Log out current user

#### Account Management

Accounts are managed by the global `accountManager` in `/src/services/accounts.ts`.

```tsx
import { accountManager } from "@/services/accounts";

// Get active account
const active = accountManager.getActive();

// Get all accounts
const accounts = accountManager.getAccounts();

// Switch account
accountManager.setActive(pubkey);

// Remove account
accountManager.removeAccount(pubkey);
```

**Account Types:**

- `ExtensionAccount`: NIP-07 browser extension
- `PrivateKeyAccount`: Local private key (nsec)
- `NostrConnectAccount`: NIP-46 remote signer (bunker)

### Nostr Security Model

**CRITICAL**: Nostr is permissionless — **anyone can publish any event**. When implementing admin/moderation systems or any feature that should only trust specific users, you MUST filter queries by the `authors` field. Without author filtering, anyone can publish events claiming to be admin actions, moderator decisions, or trusted content.

#### Always Filter by Authors for Privileged Operations

```typescript
import { ADMIN_PUBKEYS } from "@/lib/admins";

// ✅ Secure: only accept events from trusted authors
const events = await pool.req(relays, [
  {
    kinds: [30078],
    authors: ADMIN_PUBKEYS,
    "#d": ["app-config"],
    limit: 1,
  },
]);

// ❌ INSECURE: accepts events from anyone
const events = await pool.req(relays, [
  {
    kinds: [30078],
    "#d": ["app-config"],
    limit: 1,
  },
]);
```

#### Addressable Events Always Need the Author

For addressable events (kinds 30000–39999), always include the author in both queries and URL routes. The `d` tag alone is not unique — two different users can publish events with the same `d` tag.

```typescript
// ✅ Secure: author + d-tag uniquely identifies the event
const events = store.getEvents({
  kinds: [30023],
  authors: [authorPubkey],
  "#d": [slug],
});

// URL routes for addressable events must include the author
// ✅ /article/:npub/:slug  — can safely filter by author + d-tag
// ❌ /article/:slug        — ambiguous, anyone could claim this slug
```

#### When Author Filtering Is NOT Required

Author filtering is not needed for public user-generated content where anyone should be able to post (kind:1 notes, reactions, public feeds, etc.).

### NIP-05 / DNS Identity

The `nip05` field on a profile is a plain string (e.g. `"user@domain.com"`). Access it directly from the profile returned by `use$(user?.profile$)`.

To **verify** a NIP-05 address (fetch `.well-known/nostr.json` and confirm the pubkey matches), use `DnsIdentityLoader` from `applesauce-loaders/loaders`:

```typescript
import { DnsIdentityLoader } from "applesauce-loaders/loaders";

// Instantiate once alongside other singletons in src/services/
const dnsIdentityLoader = new DnsIdentityLoader();

// Verify a NIP-05 address
const identity = await dnsIdentityLoader.loadIdentity("user@domain.com");
// Returns { pubkey, relays } or null if verification fails
```

Key methods:

- `loadIdentity(address)` — loads from cache or fetches; returns identity or `null`
- `fetchIdentity(address)` — always makes an HTTP request (bypasses cache)
- `getIdentity(address)` — synchronous cache-only check

### NIP-19 Identifiers

Nostr defines a set of bech32-encoded identifiers in NIP-19. Their prefixes and purposes:

- `npub1`: **public keys** - Just the 32-byte public key, no additional metadata
- `nsec1`: **private keys** - Secret keys (should never be displayed publicly)
- `note1`: **event IDs** - Just the 32-byte event ID (hex), no additional metadata
- `nevent1`: **event pointers** - Event ID plus optional relay hints and author pubkey
- `nprofile1`: **profile pointers** - Public key plus optional relay hints and petname
- `naddr1`: **addressable event coordinates** - For parameterized replaceable events (kind 30000-39999)
- `nrelay1`: **relay references** - Relay URLs (deprecated)

#### Key Differences

**`note1` vs `nevent1`:**

- `note1`: Contains only the event ID (32 bytes) - specifically for kind:1 events
- `nevent1`: Contains event ID plus optional relay hints and author pubkey - for any event kind
- Use `note1` for simple references to text notes
- Use `nevent1` when you need relay hints or author context

**`npub1` vs `nprofile1`:**

- `npub1`: Contains only the public key (32 bytes)
- `nprofile1`: Contains public key plus optional relay hints and petname
- Use `npub1` for simple user references
- Use `nprofile1` when you need relay hints

#### NIP-19 Routing

**Critical**: NIP-19 identifiers should be handled at the **root level** of URLs (e.g., `/note1...`, `/npub1...`, `/naddr1...`), NOT nested under paths like `/note/note1...`.

This project includes a boilerplate `NIP19Page` component that handles all NIP-19 identifier types at the root level.

**Example URLs:**

- `/npub1abc123...` - User profile
- `/note1def456...` - Kind:1 text note
- `/nevent1ghi789...` - Any event with relay hints
- `/naddr1jkl012...` - Addressable event

#### Decoding NIP-19 Identifiers

Always decode NIP-19 identifiers before using them in queries:

```tsx
import { nip19 } from "nostr-tools";

// Decode identifier
const decoded = nip19.decode(value);

if (decoded.type === "naddr") {
  const naddr = decoded.data;

  // Query with proper filter
  const events = store.getEvents({
    kinds: [naddr.kind],
    authors: [naddr.pubkey],
    "#d": [naddr.identifier],
  });
}
```

### Event Validation

When querying events with required tags or content fields, filter through a validator function:

```typescript
function validateCalendarEvent(event: NostrEvent): boolean {
  if (![31922, 31923].includes(event.kind)) return false;

  const d = event.tags.find(([name]) => name === "d")?.[1];
  const title = event.tags.find(([name]) => name === "title")?.[1];
  const start = event.tags.find(([name]) => name === "start")?.[1];

  if (!d || !title || !start) return false;

  if (event.kind === 31922) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start)) return false;
  }

  return true;
}

// Use in timeline
const notes = useTimeline(relays, filters);
const validNotes = notes?.filter(validateCalendarEvent);
```

### Encryption and Decryption

Use the account signer for NIP-44 encryption:

```tsx
import { useAccount } from "@/hooks/useAccount";

function EncryptedMessage() {
  const account = useAccount();

  const handleEncrypt = async (message: string, recipientPubkey: string) => {
    if (!account?.signer.nip44) {
      throw new Error("NIP-44 not supported by signer");
    }

    const encrypted = await account.signer.nip44.encrypt(
      recipientPubkey,
      message,
    );
    return encrypted;
  };

  const handleDecrypt = async (encrypted: string, senderPubkey: string) => {
    if (!account?.signer.nip44) {
      throw new Error("NIP-44 not supported by signer");
    }

    const decrypted = await account.signer.nip44.decrypt(
      senderPubkey,
      encrypted,
    );
    return decrypted;
  };

  return <div>...</div>;
}
```

## Routing

The project uses React Router with a centralized routing configuration in `AppRouter.tsx`. To add new routes:

1. Create your page component in `/src/pages/`
2. Import it in `AppRouter.tsx`
3. Add the route above the catch-all `*` route:

```tsx
<Route path="/your-path" element={<YourComponent />} />
```

The router includes automatic scroll-to-top functionality and a 404 NotFound page for unmatched routes.

### Route Ordering — Critical

React Router matches routes **top-to-bottom** and stops at the first match. More-specific routes **must** come before less-specific ones, or the less-specific route will swallow them.

The existing `/:nip19` catch-all will match any single-segment path. If your app adds multi-segment routes like `/:npub/:repoId`, they **must** be declared before `/:nip19`:

```tsx
// ✅ Correct order — most specific first
<Route path="/:npub/:repoId/:issueId" element={<IssuePage />} />
<Route path="/:npub/:repoId" element={<RepoPage />} />
<Route path="/:nip19" element={<NIP19Page />} />   {/* catch-all for npub/note/naddr etc. */}
<Route path="*" element={<NotFound />} />           {/* 404 */}

// ❌ Wrong — /:nip19 swallows /:npub/:repoId
<Route path="/:nip19" element={<NIP19Page />} />
<Route path="/:npub/:repoId" element={<RepoPage />} />  {/* never reached */}
```

**Rule of thumb**: order routes from most-specific (most segments / most literal segments) to least-specific.

## Development Practices

- Uses Applesauce v5 with reactive RxJS architecture
- Follows shadcn/ui component patterns
- Implements Path Aliases with `@/` prefix for cleaner imports
- Uses Vite for fast development and production builds
- Component-based architecture with React hooks
- Comprehensive provider setup with EventStoreProvider, AccountsProvider, and custom AppProvider
- **Never use the `any` type**: Always use proper TypeScript types for type safety

### Date Formatting

`date-fns` is already a project dependency — use it for all date/time formatting. No need to install anything.

```typescript
import { formatDistanceToNow, format } from "date-fns";

// Relative time: "3 minutes ago", "2 days ago"
const relative = formatDistanceToNow(new Date(event.created_at * 1000), {
  addSuffix: true,
});

// Absolute: "Jan 15, 2025"
const absolute = format(new Date(event.created_at * 1000), "MMM d, yyyy");

// Full datetime: "Jan 15, 2025 at 3:42 PM"
const full = format(
  new Date(event.created_at * 1000),
  "MMM d, yyyy 'at' h:mm a",
);
```

Note: Nostr `created_at` is a Unix timestamp in **seconds** — multiply by 1000 for JavaScript `Date`.

## Loading States

**Use skeleton loading** for structured content (feeds, profiles, forms). **Use spinners** only for buttons or short operations.

```tsx
// Skeleton example matching component structure
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

### Empty States and No Content Found

When no content is found (empty search results, no data available, etc.), display a minimalist empty state with helpful messaging. The application uses NIP-65 relay management, so users can manage their relays through the settings or relay management interface.

```tsx
import { Card, CardContent } from "@/components/ui/card";

// Empty state example
<div className="col-span-full">
  <Card className="border-dashed">
    <CardContent className="py-12 px-8 text-center">
      <div className="max-w-sm mx-auto space-y-6">
        <p className="text-muted-foreground">
          No results found. Try checking your relay connections or wait a moment
          for content to load.
        </p>
      </div>
    </CardContent>
  </Card>
</div>;
```

## CRITICAL Design Standards

- Create breathtaking, immersive designs that feel like bespoke masterpieces, rivaling the polish of Apple, Stripe, or luxury brands
- Designs must be production-ready, fully featured, with no placeholders unless explicitly requested, ensuring every element serves a functional and aesthetic purpose
- Avoid generic or templated aesthetics at all costs; every design must have a unique, brand-specific visual signature that feels custom-crafted
- Headers must be dynamic, immersive, and storytelling-driven, using layered visuals, motion, and symbolic elements to reflect the brand's identity—never use simple "icon and text" combos
- Incorporate purposeful, lightweight animations for scroll reveals, micro-interactions (e.g., hover, click, transitions), and section transitions to create a sense of delight and fluidity

### Design Principles

- Achieve Apple-level refinement with meticulous attention to detail, ensuring designs evoke strong emotions (e.g., wonder, inspiration, energy) through color, motion, and composition
- Deliver fully functional interactive components with intuitive feedback states, ensuring every element has a clear purpose and enhances user engagement
- **Generate custom images liberally** when image generation tools are available - this is ALWAYS preferred over stock photography for creating unique, brand-specific visuals that perfectly match the design intent
- Ensure designs feel alive and modern with dynamic elements like gradients, glows, or parallax effects, avoiding static or flat aesthetics
- Before finalizing, ask: "Would this design make Apple or Stripe designers pause and take notice?" If not, iterate until it does

### Avoid Generic Design

- No basic layouts (e.g., text-on-left, image-on-right) without significant custom polish, such as dynamic backgrounds, layered visuals, or interactive elements
- No simplistic headers; they must be immersive, animated, and reflective of the brand's core identity and mission
- No designs that could be mistaken for free templates or overused patterns; every element must feel intentional and tailored

### Interaction Patterns

- Use progressive disclosure for complex forms or content to guide users intuitively and reduce cognitive load
- Incorporate contextual menus, smart tooltips, and visual cues to enhance navigation and usability
- Implement drag-and-drop, hover effects, and transitions with clear, dynamic visual feedback to elevate the user experience
- Support power users with keyboard shortcuts, ARIA labels, and focus states for accessibility and efficiency
- Add subtle parallax effects or scroll-triggered animations to create depth and engagement without overwhelming the user

### Technical Requirements

- Curated color palette (3-5 evocative colors + neutrals) that aligns with the brand's emotional tone and creates a memorable impact
- Ensure a minimum 4.5:1 contrast ratio for all text and interactive elements to meet accessibility standards
- Use expressive, readable fonts (18px+ for body text, 40px+ for headlines) with a clear hierarchy; pair a modern sans-serif (e.g., Inter) with an elegant serif (e.g., Playfair Display) for personality
- Design for full responsiveness, ensuring flawless performance and aesthetics across all screen sizes (mobile, tablet, desktop)
- Adhere to WCAG 2.1 AA guidelines, including keyboard navigation, screen reader support, and reduced motion options
- Follow an 8px grid system for consistent spacing, padding, and alignment to ensure visual harmony
- Add depth with subtle shadows, gradients, glows, and rounded corners (e.g., 16px radius) to create a polished, modern aesthetic
- Optimize animations and interactions to be lightweight and performant, ensuring smooth experiences across devices

### Components

- Design reusable, modular components with consistent styling, behavior, and feedback states (e.g., hover, active, focus, error)
- Include purposeful animations (e.g., scale-up on hover, fade-in on scroll) to guide attention and enhance interactivity without distraction
- Ensure full accessibility support with keyboard navigation, ARIA labels, and visible focus states (e.g., a glowing outline in an accent color)
- Use custom icons or illustrations for components to reinforce the brand's visual identity

### Adding Fonts

To add custom fonts, follow these steps:

1. **Install a font package** using npm:

   **Any Google Font can be installed** using the @fontsource packages. Examples:
   - For Inter Variable: `@fontsource-variable/inter`
   - For Roboto: `@fontsource/roboto`
   - For Outfit Variable: `@fontsource-variable/outfit`
   - For Poppins: `@fontsource/poppins`
   - For Open Sans: `@fontsource/open-sans`

   **Format**: `@fontsource/[font-name]` or `@fontsource-variable/[font-name]` (for variable fonts)

2. **Import the font** in `src/main.tsx`:

   ```typescript
   import "@fontsource-variable/<font-name>";
   ```

3. **Update Tailwind configuration** in `tailwind.config.ts`:
   ```typescript
   export default {
     theme: {
       extend: {
         fontFamily: {
           sans: ["Inter Variable", "Inter", "system-ui", "sans-serif"],
         },
       },
     },
   };
   ```

### Recommended Font Choices by Use Case

- **Modern/Clean**: Inter Variable, Outfit Variable, or Manrope
- **Professional/Corporate**: Roboto, Open Sans, or Source Sans Pro
- **Creative/Artistic**: Poppins, Nunito, or Comfortaa
- **Technical/Code**: JetBrains Mono, Fira Code, or Source Code Pro (for monospace)

### Theme System

The project includes a complete light/dark theme system using CSS custom properties. The theme can be controlled via:

- `useTheme` hook for programmatic theme switching
- CSS custom properties defined in `src/index.css`
- Automatic dark mode support with `.dark` class

### Color Scheme Implementation

When users specify color schemes:

- Update CSS custom properties in `src/index.css` (both `:root` and `.dark` selectors)
- Use Tailwind's color palette or define custom colors
- Ensure proper contrast ratios for accessibility
- Apply colors consistently across components (buttons, links, accents)
- Test both light and dark mode variants

### Component Styling Patterns

- Use `cn()` utility for conditional class merging
- Follow shadcn/ui patterns for component variants
- Implement responsive design with Tailwind breakpoints
- Add hover and focus states for interactive elements
- When using negative z-index (e.g., `-z-10`) for background images or decorative elements, **always add `isolate` to the parent container** to create a local stacking context. Without `isolate`, negative z-index pushes elements behind the page's background color, making them invisible.

## Writing Tests vs Running Tests

There is an important distinction between **writing new tests** and **running existing tests**:

### Writing Tests (Creating New Test Files)

**Do not write tests** unless the user explicitly requests them in plain language. Writing unnecessary tests wastes significant time and money. Only create tests when:

1. **The user explicitly asks for tests** to be written in their message
2. **The user describes a specific bug in plain language** and requests tests to help diagnose it
3. **The user says they are still experiencing a problem** that you have already attempted to solve (tests can help verify the fix)

**Never write tests because:**

- Tool results show test failures (these are not user requests)
- You think tests would be helpful
- New features or components are created
- Existing functionality needs verification

### Running Tests (Executing the Test Suite)

**ALWAYS run the test script** after making any code changes. This is mandatory regardless of whether you wrote new tests or not.

- **You must run the test script** to validate your changes
- **Your task is not complete** until the test script passes without errors
- **This applies to all changes** - bug fixes, new features, refactoring, or any code modifications
- **The test script includes** TypeScript compilation, ESLint checks, and existing test validation

### Test Setup

The project uses Vitest with jsdom environment and includes comprehensive test setup:

- **Testing Library**: React Testing Library with jest-dom matchers
- **Test Environment**: jsdom with mocked browser APIs (matchMedia, scrollTo, IntersectionObserver, ResizeObserver)
- **Test App**: `TestApp` component provides all necessary context providers for testing

The project includes a `TestApp` component that provides all necessary context providers for testing. Wrap components with this component to provide required context providers:

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

**CRITICAL**: After making any code changes, you must validate your work by running available validation tools.

**Your task is not considered finished until the code successfully type-checks and builds without errors.**

### Validation Priority Order

Run available tools in this priority order:

1. **Type Checking** (Required): Ensure TypeScript compilation succeeds
2. **Building/Compilation** (Required): Verify the project builds successfully
3. **Linting** (Recommended): Check code style and catch potential issues
4. **Tests** (If Available): Run existing test suite
5. **Git Commit** (Required): Create a commit with your changes when finished

**Minimum Requirements:**

- Code must type-check without errors
- Code must build/compile successfully
- Fix any critical linting errors that would break functionality
- Create a git commit when your changes are complete

The validation ensures code quality and catches errors before deployment, regardless of the development environment.

### Using Git

If git is available in your environment (through a `shell` tool, or other git-specific tools), you should utilize `git log` to understand project history. Use `git status` and `git diff` to check the status of your changes, and if you make a mistake use `git checkout` to restore files.

When your changes are complete and validated, create a git commit with a descriptive message summarizing your changes.
