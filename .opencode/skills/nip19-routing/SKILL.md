---
name: nip19-routing
description: Handle NIP-19 bech32 identifiers (`npub1`, `nprofile1`, `note1`, `nevent1`, `naddr1`) in URLs, decode them for relay queries, and order routes correctly so the `/:nip19` catch-all doesn't swallow multi-segment routes like `/:npub/:repoId`. Activates when adding routes, building NIP-19 links, or wiring `NIP19Page`.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

# NIP-19 Identifiers and Routing

## Identifier types

| Prefix      | Contains                                              | Use for                                           |
| ----------- | ----------------------------------------------------- | ------------------------------------------------- |
| `npub1`     | 32-byte pubkey                                        | Simple user references                            |
| `nsec1`     | 32-byte private key                                   | **Never display, never route — always 404**       |
| `note1`     | 32-byte event ID (kind 1 by convention)               | Simple references to text notes                   |
| `nevent1`   | Event ID + relay hints + author pubkey                | Any event kind, when relay hints help discovery   |
| `nprofile1` | Pubkey + relay hints + petname                        | User refs when relay hints help discovery         |
| `naddr1`    | `kind` + `pubkey` + `identifier` (+ relay hints)      | Addressable events (kinds 30000–39999)            |

**Choosing between them:**

- `note1` vs `nevent1`: use `note1` for simple text-note refs; use `nevent1` for any other kind, or whenever you have relay hints / author context.
- `npub1` vs `nprofile1`: use `npub1` for plain refs; use `nprofile1` when relay hints help.

## Root-level routing

**All NIP-19 identifiers route at the URL root** (`/note1...`, `/npub1...`, `/naddr1...`), handled by `src/pages/NIP19Page.tsx`. **Never** nest under `/note/`, `/profile/`, etc.

```text
/npub1abc...    → user profile
/note1def...    → kind:1 text note
/nevent1ghi...  → any event with relay hints
/naddr1jkl...   → addressable event
```

## Route ordering — critical

React Router matches **top-to-bottom and stops at the first match.** The `/:nip19` catch-all matches **any single-segment path**. Multi-segment routes must be declared **above** it:

```tsx
// ✅ Correct order — most-specific first
<Route path="/:npub/:repoId/issues/:issueId" element={<IssuePage />} />
<Route path="/:npub/:repoId/pulls/:prId"     element={<PRPage />} />
<Route path="/:npub/:repoId"                 element={<RepoPage />} />
<Route path="/:nip19"                        element={<NIP19Page />} />  {/* catch-all */}
<Route path="*"                              element={<NotFound />} />   {/* 404 */}

// ❌ Wrong — /:nip19 swallows /:npub/:repoId
<Route path="/:nip19" element={<NIP19Page />} />
<Route path="/:npub/:repoId" element={<RepoPage />} />  {/* never reached */}
```

**Rule of thumb:** order routes from most-specific (most segments / most literal segments) to least-specific.

## Decoding for queries

Filters only accept hex. Always decode before querying:

```ts
import { nip19 } from "nostr-tools";

const decoded = nip19.decode(value);
if (decoded.type !== "naddr") throw new Error("Unsupported identifier");
const { kind, pubkey, identifier } = decoded.data;

// IMPORTANT: filter by author too — d-tag alone is not unique
const events = store.getEvents({
  kinds: [kind],
  authors: [pubkey],
  "#d": [identifier],
});
```

For `nevent1`, decoded data has `id`, `author?`, `kind?`, `relays?` — pass `relays` into your `resilientSubscription` call to take advantage of the hint.

For `nprofile1`, decoded data has `pubkey` and `relays?`.

For `naddr1`, decoded data has `kind`, `pubkey`, `identifier`, `relays?` — **always include `pubkey` in `authors`** when querying (see the `nostr-security` skill for why).

## Building NIP-19 strings

```ts
import { nip19 } from "nostr-tools";

nip19.npubEncode(pubkey);
nip19.noteEncode(eventId);
nip19.neventEncode({ id, author, kind, relays });
nip19.nprofileEncode({ pubkey, relays });
nip19.naddrEncode({ kind, pubkey, identifier, relays });
```

Don't truncate raw hex pubkeys when displaying user-facing links — show `npub1...` or a profile name.

## `NIP19Page` skeleton

`src/pages/NIP19Page.tsx` already exists in this project. To extend it for a new identifier type or fall-back behaviour, branch on `decoded.type` and render the appropriate page (a profile view for `npub`/`nprofile`, an article view for `naddr`'s kind 30023, etc.). Treat unknown prefixes and `nsec1` as a 404.

## Security recap

- Addressable events (30000–39999): always include `authors` in queries. The d-tag alone is **not** a trust boundary.
- URL routes for addressable events: include the author (`/:npub/:repoId`, not `/:repoId`). Multi-segment routes go above `/:nip19`.
- See the `nostr-security` skill for the full pattern.
