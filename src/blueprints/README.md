# Custom Blueprints

This directory contains custom event blueprints for your application.

Blueprints are templates for creating properly formatted Nostr events. They use the `blueprint()` helper from `applesauce-core/event-factory` to compose operations into a reusable event template.

## Example Usage

```typescript
import { blueprint } from "applesauce-core/event-factory";
import {
  setContent,
  includeAltTag,
  includeSingletonTag,
} from "applesauce-core/operations";
import { modifyPublicTags } from "applesauce-core/operations";

export const MY_KIND = 30023;

export function MyCustomBlueprint(title: string, content: string) {
  return blueprint(
    MY_KIND,
    modifyPublicTags((tags) => [
      ...tags,
      ["d", title.toLowerCase().replace(/\s+/g, "-")],
    ]),
    modifyPublicTags((tags) => [...tags, ["title", title]]),
    setContent(content),
    includeAltTag(`Article: ${title}`),
  );
}
```

## Creating Events with Blueprints

```typescript
import { factory } from "@/services/actions";
import { publish } from "@/services/nostr";
import { MyCustomBlueprint } from "@/blueprints/custom";

// Method 1: pass blueprint constructor + args separately
const event = await factory.create(MyCustomBlueprint, "My Title", "My content");

// Method 2: call blueprint directly and pass result
const event2 = await factory.create(
  MyCustomBlueprint("My Title", "My content"),
);

// Sign and publish
const signed = await factory.sign(event);
await publish(signed);
```

## Available Built-in Blueprints

Applesauce provides many built-in blueprints in `applesauce-common/blueprints`:

- `NoteBlueprint` - Kind 1 text notes
- `ReactionBlueprint` - Kind 7 reactions
- `CommentBlueprint` - Kind 1111 comments (NIP-22)
- `ArticleBlueprint` - Kind 30023 long-form content
- `ShareBlueprint` - Kind 6/16 reposts

Check the applesauce documentation for the full list.

## Important: v5 API

Always use `applesauce-core/event-factory` — **not** the old `applesauce-factory` package.
