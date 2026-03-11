# Custom Operations

This directory contains custom event operations for your application.

Operations are composable functions that modify event templates. They can be chained together inside blueprints to build complex events.

## Type

```typescript
import type { EventOperation } from "applesauce-core/event-factory";
```

An `EventOperation` receives `(draft: EventTemplate, context: EventFactoryContext)` and returns a modified `EventTemplate` (or a `Promise` of one).

## Example Usage

```typescript
import type { EventOperation } from "applesauce-core/event-factory";
import { modifyPublicTags } from "applesauce-core/operations";

/**
 * Set a singleton "subject" tag on the event.
 */
export function setSubject(subject: string): EventOperation {
  return modifyPublicTags((tags) => {
    const filtered = tags.filter(([t]) => t !== "subject");
    return [...filtered, ["subject", subject]];
  });
}

/**
 * Add a "t" label tag.
 */
export function addLabel(label: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["t", label]]);
}
```

## Using Operations in Blueprints

```typescript
import { blueprint } from "applesauce-core/event-factory";
import { setContent } from "applesauce-core/operations";
import { setSubject, addLabel } from "@/operations/issue";

export function IssueBlueprint(subject: string, content: string) {
  return blueprint(
    1621,
    setSubject(subject),
    setContent(content),
    addLabel("bug"),
  );
}
```

## Available Built-in Operations

Applesauce provides built-in operations in `applesauce-core/operations`:

- `setContent(text)` — Set event content
- `modifyPublicTags(fn)` — Transform the public tags array
- `modifyHiddenTags(fn)` — Transform hidden (encrypted) tags
- `includeSingletonTag(tag)` — Ensure only one tag of this name exists
- `includeAltTag(description)` — Add NIP-31 alt tag
- `includeReplaceableIdentifier(id?)` — Add/ensure `d` tag for addressable events
- `setEncryptedContent(pubkey, plaintext)` — NIP-44 encrypted content

And tag-level helpers in `applesauce-core/operations` (used inside `modifyPublicTags`):

- `setSingletonTag(tag)` — Replace any existing tag with the same name
- `addPubkeyTag(pubkey)` — Add a `p` tag with optional relay hint
- `addEventPointerTag(id)` — Add an `e` tag with optional relay hint

Check the applesauce documentation for the full list.

## Important: v5 API

Always use `applesauce-core/event-factory` and `applesauce-core/operations` — **not** the old `applesauce-factory` package.
