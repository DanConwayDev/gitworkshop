# ngitstack Custom Nostr Events

## Notification Read State (kind 30078)

Uses [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md) (Arbitrary Custom App Data) to persist notification read/archived state across devices.

### Event Structure

```json
{
  "kind": 30078,
  "tags": [["d", "git-notifications-state"]],
  "content": "<NIP-44 encrypted JSON>"
}
```

### Encrypted Content Schema

The `content` field is NIP-44 encrypted to self (the user's own pubkey). When decrypted, it contains a JSON object with the following fields:

| Field | Type       | Description                                                                                            |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `rb`  | `number`   | Unix timestamp (seconds). All notification events with `created_at <= rb` are considered **read**.     |
| `ri`  | `string[]` | Event IDs individually marked as read that have `created_at > rb` (exceptions after the cutoff).       |
| `ab`  | `number`   | Unix timestamp (seconds). All notification events with `created_at <= ab` are considered **archived**. |
| `ai`  | `string[]` | Event IDs individually marked as archived that have `created_at > ab` (exceptions after the cutoff).   |

### Example (decrypted content)

```json
{
  "rb": 1711900000,
  "ri": ["aabb...", "ccdd..."],
  "ab": 1711800000,
  "ai": ["eeff..."]
}
```

### Design Rationale

The high-water-mark model keeps the payload compact:

- The timestamp cutoff (`rb`/`ab`) marks everything older as read/archived without storing individual IDs.
- The ID arrays (`ri`/`ai`) only hold exceptions — events newer than the cutoff that have been individually acted on.
- Periodically the cutoff is advanced and the arrays are pruned, keeping the payload bounded.

This is the same model used by [gitworkshop.dev](https://gitworkshop.dev) for notification state, adapted from localStorage to NIP-78 for cross-device sync.

### Notification Events

The following events are considered "notifications" for a user with pubkey `P`:

1. **NIP-22 comments** (kind 1111) on NIP-34 issues/PRs/patches authored by `P`:
   - Filter: `{ kinds: [1111], "#P": [P], "#K": ["1617", "1618", "1621"] }`

2. **New issues/PRs/patches** that tag `P` directly:
   - Filter: `{ kinds: [1621, 1618, 1617, 1, 1622], "#p": [P] }`

Events authored by `P` themselves are excluded from the notification list.
