---
name: nostr-security
description: Apply Nostr's permissionless trust model — filter queries by `authors` for any privileged operation (admins, moderators, addressable events owned by a specific user) so spoofed events can't impersonate trusted parties. Activates when implementing admin/moderation features, querying or routing to addressable events (kinds 30000–39999), validating event authorship, or designing URL schemes for owned content.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

# Nostr Security Model

**Nostr is permissionless — anyone can publish any event.** Any feature that implies trust (admin actions, moderator decisions, addressable events owned by a specific user) MUST filter queries by the `authors` field. Without that, attackers can publish spoofed events that masquerade as admin actions, moderator approvals, or trusted content.

## Always filter by authors for privileged operations

```ts
import { ADMIN_PUBKEYS } from "@/lib/admins";

// ✅ Secure — only accept events from trusted authors
resilientRequest(pool, relays, [{
  kinds: [30078],
  authors: ADMIN_PUBKEYS,
  "#d": ["app-config"],
  limit: 1,
}]);

// ❌ INSECURE — accepts events from anyone
resilientRequest(pool, relays, [{
  kinds: [30078],
  "#d": ["app-config"],
  limit: 1,
}]);
```

## Addressable events (kinds 30000–39999) always need the author

The `d` tag alone is **not** unique — two different users can publish events with the same `d` tag. `pubkey + kind + d-tag` is the trust-bearing identity:

```ts
// ✅ Secure
const events = store.getEvents({
  kinds: [30023],
  authors: [authorPubkey],
  "#d": [slug],
});
```

**URL routes for addressable events MUST include the author:**

```tsx
// ✅ /article/:npub/:slug  — author + slug uniquely identifies the event
// ❌ /article/:slug        — ambiguous, anyone could claim this slug
```

This is why this project uses `/:npub/:repoId/...` for repository routes — see the `nip19-routing` skill for ordering rules with the `/:nip19` catch-all.

## NIP-72 moderated communities

Don't trust arbitrary kind 4550 (community approval) events. Resolve trust through the community owner:

1. Fetch the community definition (kind 34550) **filtered by the community owner's pubkey**.
2. Extract moderator pubkeys from `p` tags with role `moderator`.
3. Filter approval events with `authors: moderatorPubkeys`.

Without that chain, anyone can publish a "moderator approval" and it will be treated as legitimate.

## When author filtering is NOT required

Public user-generated content where anyone is allowed to post:

- Kind 1 notes
- Reactions (kind 7)
- Public feeds and discovery queries
- Comments where the *content* is what matters, not who said it

In those cases, filtering by author would defeat the point.

## Kind selection and trust

When you generate a new kind, decide whether the event represents:

- **A user statement** (anyone can publish; trust comes from who signed it) — no author filter needed at the relay, but UI should still show the author.
- **A privileged action** (admin config, moderator approval, addressable owned content) — always filter by author.

Document the trust model in `NIP.md` whenever you add a kind that requires author filtering.
