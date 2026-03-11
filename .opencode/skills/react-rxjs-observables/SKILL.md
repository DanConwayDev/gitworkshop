---
name: react-rxjs-observables
description: Use RxJS observables in React components with the use$ hook from applesauce-react
license: MIT
compatibility: opencode
metadata:
  framework: react
  library: applesauce
  audience: developers
---

# Using RxJS Observables in React Components

This skill teaches you how to integrate RxJS observables into React components using the `use$` hook from `applesauce-react`.

## What I do

- Show you how to subscribe to observables and automatically manage their lifecycle
- Explain the factory function pattern with dependencies for reactive data
- Cover common patterns like chained observables, side effects, and conditional subscriptions
- Help you avoid common mistakes with dependency arrays and re-subscriptions
- Guide you through loading states, error handling, and performance optimization

## When to use me

Use this skill when you need to:

- Subscribe to RxJS observables in React components
- Work with Applesauce models (ProfileModel, ThreadModel, CommentsModel, etc.)
- Access reactive properties from casts like `note.author.profile$`, `user.contacts$`, etc.
- Set up relay subscriptions or event loaders
- Combine multiple observables with `combineLatest`, `switchMap`, or other RxJS operators
- Debug infinite re-subscription loops or stale data issues

## Core Hook: `use$`

Import from your hooks directory:

```typescript
import { use$ } from "@/hooks/use$";
```

### Type Signatures

```typescript
// Direct BehaviorSubject - always returns a value
use$<T>(observable?: BehaviorSubject<T>): T

// Direct Observable - may return undefined if no value emitted yet
use$<T>(observable?: Observable<T>): T | undefined

// Factory function with dependencies - MOST COMMON
use$<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined
```

## Usage Patterns

### Pattern 1: Factory Function

**This is the most common pattern.** Use when the observable depends on props, state, or context:

```tsx
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { ProfileModel } from "applesauce-core/models";

function UserProfile({ pubkey }: { pubkey: string }) {
  const store = useEventStore();

  // Factory recreates observable when pubkey or store changes
  const profile = use$(
    () => store.model(ProfileModel, pubkey),
    [pubkey, store],
  );

  if (!profile) return <Skeleton />;

  return <div>{profile.name}</div>;
}
```

### Pattern 2: Direct Observable

Use for global observables that don't need to be recreated:

```tsx
import { use$ } from "@/hooks/use$";
import { BehaviorSubject } from "rxjs";

const theme$ = new BehaviorSubject<"light" | "dark">("light");

function ThemeDisplay() {
  const theme = use$(theme$);
  return <div>Theme: {theme}</div>;
}
```

### Pattern 3: Nested Cast Properties

Applesauce casts expose properties as observables:

```tsx
import { use$ } from "@/hooks/use$";
import { Note } from "applesauce-common/casts";

function NoteCard({ note }: { note: Note }) {
  // Subscribe to nested observables
  const author = use$(note.author.profile$);
  const reactions = use$(note.reactions$);
  const replyCount = use$(note.replies?.count$);

  return (
    <div>
      <span>{author?.name ?? "Anonymous"}</span>
      <p>{note.content}</p>
      <span>{reactions?.length ?? 0} reactions</span>
      <span>{replyCount ?? 0} replies</span>
    </div>
  );
}
```

### Pattern 5: Chained Observables

Combine multiple observables with RxJS operators:

```tsx
import { use$ } from "@/hooks/use$";
import { combineLatest } from "rxjs";
import { map } from "rxjs/operators";

function ContactsWithRelays({ pubkey }: { pubkey: string }) {
  const store = useEventStore();

  const contacts = use$(() => {
    const user = store.castUser(pubkey);
    return user ? user.contacts$ : undefined;
  }, [pubkey, store]);

  // Combine each contact's outboxes
  const contactsWithOutboxes = use$(() => {
    if (!contacts) return undefined;

    return combineLatest(
      contacts.map((contact) =>
        contact.outboxes$.pipe(map((outboxes) => ({ contact, outboxes }))),
      ),
    );
  }, [contacts?.map((c) => c.pubkey).join(",")]);

  return <div>...</div>;
}
```

## Dependency Arrays: Critical Rules

The dependency array controls when the observable is recreated.

### ✅ DO: Include all variables used in factory

```tsx
const profile = use$(
  () => store.model(ProfileModel, pubkey),
  [pubkey, store], // Both used in factory
);
```

### ✅ DO: Serialize arrays and objects

```tsx
// For arrays - use .join()
const events = use$(
  () => pool.req(relays, filters),
  [relays.join(","), JSON.stringify(filters)],
);

// For optional arrays - use optional chaining
const data = use$(
  () => fetchData(contacts),
  [contacts?.map((c) => c.pubkey).join(",")],
);
```

### ❌ DON'T: Pass array/object references directly

```tsx
// WRONG - infinite re-subscriptions!
const events = use$(
  () => pool.req(relays, filters),
  [relays, filters], // References change every render
);
```

### ❌ DON'T: Omit dependencies

```tsx
// WRONG - stale data!
const profile = use$(
  () => store.model(ProfileModel, pubkey),
  [], // pubkey changes won't update!
);
```

## Loading States

`use$` returns `undefined` while waiting for the first value:

```tsx
function UserProfile({ pubkey }: { pubkey: string }) {
  const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey]);

  // Always handle undefined
  if (!profile) {
    return <Skeleton />;
  }

  return <div>{profile.name}</div>;
}
```

**Exception:** BehaviorSubjects always have a current value:

```tsx
const theme$ = new BehaviorSubject("light");
const theme = use$(theme$); // Never undefined
```

## Common Mistakes to Avoid

### 1. Missing Dependencies

```tsx
// ❌ WRONG
const profile = use$(() => store.model(ProfileModel, pubkey), []);

// ✅ CORRECT
const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey, store]);
```

### 2. Unstable Dependencies

```tsx
// ❌ WRONG
const events = use$(() => store.timeline(filters), [filters]);

// ✅ CORRECT
const events = use$(() => store.timeline(filters), [JSON.stringify(filters)]);
```

### 3. Conditional Hook Calls

```tsx
// ❌ WRONG - breaks rules of hooks
if (condition) {
  const data = use$(observable$);
}

// ✅ CORRECT
const data = use$(() => (condition ? observable$ : undefined), [condition]);
```

### 4. Not Handling Undefined

```tsx
// ❌ WRONG - runtime error
const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey]);
return <div>{profile.name}</div>; // Error if undefined!

// ✅ CORRECT
const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey]);
return <div>{profile?.name ?? "Loading..."}</div>;
```

## Performance Tips

### Avoid Creating New Arrays in Dependencies

```tsx
// ❌ Bad - creates new array every render
const pubkeys = items.map((i) => i.pubkey);
const data = use$(() => fetch(pubkeys), [pubkeys]);

// ✅ Good - stable string reference
const data = use$(
  () => fetch(items.map((i) => i.pubkey)),
  [items.map((i) => i.pubkey).join(",")],
);
```

### Memoize Complex Objects

```tsx
const stableKey = useMemo(
  () => JSON.stringify(complexConfig),
  [complexConfig.field1, complexConfig.field2],
);

const data = use$(() => fetchData(complexConfig), [stableKey]);
```

## Error Handling

Errors from observables are thrown and caught by React Error Boundaries:

```tsx
import { ErrorBoundary } from "react-error-boundary";

function App() {
  return (
    <ErrorBoundary fallback={<ErrorFallback />}>
      <ComponentWithObservable />
    </ErrorBoundary>
  );
}
```

## Quick Reference

| Pattern             | When to Use                                   | Example                                       |
| ------------------- | --------------------------------------------- | --------------------------------------------- |
| Factory function    | Observable depends on props/state             | `use$(() => store.model(Model, id), [id])`    |
| Direct observable   | Global observable, no dependencies            | `use$(globalObservable$)`                     |
| Nested properties   | Cast properties like `profile$`, `reactions$` | `use$(note.author.profile$)`                  |
| Side effects        | Relay subscriptions, loaders                  | `use$(() => pool.subscription(...), [deps])`  |
| Chained observables | Combining multiple sources                    | `use$(() => combineLatest([...]), [deps])`    |
| Conditional         | Optional observable                           | `use$(() => cond ? obs$ : undefined, [cond])` |

## Remember

1. **Always** use the factory function pattern when observable depends on props/state
2. **Always** include all used variables in the dependency array
3. **Always** serialize arrays and objects in dependencies (`.join()`, `JSON.stringify()`)
4. **Always** handle `undefined` return values (except for BehaviorSubjects)
5. **Never** call `use$` conditionally
6. **Never** pass array/object references directly in dependencies
