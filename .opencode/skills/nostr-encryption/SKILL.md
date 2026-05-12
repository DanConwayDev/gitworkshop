---
name: nostr-encryption
description: Encrypt and decrypt Nostr payloads using NIP-44 (preferred) or NIP-04 (legacy) via the user's signer. Activates when building DMs, gift-wrapped messages, encrypted notes, or any feature that needs per-recipient or per-sender encryption.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

# Nostr Encryption (NIP-44 / NIP-04)

Encryption is performed by the user's signer — you never touch raw keys. The signer is exposed via `useAccount()` and supports both NIP-44 (current) and NIP-04 (legacy).

**Always prefer NIP-44** — NIP-04 is deprecated and only useful for compatibility with old clients/messages.

## NIP-44 (preferred)

```ts
import { useAccount } from "@/hooks/useAccount";

function EncryptedMessage() {
  const account = useAccount();

  const encrypt = async (recipientPubkey: string, plaintext: string) => {
    if (!account?.signer.nip44) throw new Error("NIP-44 not supported by signer");
    return account.signer.nip44.encrypt(recipientPubkey, plaintext);
  };

  const decrypt = async (senderPubkey: string, ciphertext: string) => {
    if (!account?.signer.nip44) throw new Error("NIP-44 not supported by signer");
    return account.signer.nip44.decrypt(senderPubkey, ciphertext);
  };
}
```

## NIP-04 (legacy)

```ts
account.signer.nip04?.encrypt(recipientPubkey, plaintext);
account.signer.nip04?.decrypt(senderPubkey, ciphertext);
```

Use only when interoperating with clients that haven't moved to NIP-44 yet (e.g. some kind:4 DM clients).

## Signer support detection

Not every signer supports every NIP. Check before calling:

```ts
if (!account?.signer.nip44) {
  // Fall back to NIP-04 or show "your signer doesn't support encryption"
}
```

NIP-46 bunker signers may need to round-trip to a remote process; expect higher latency than the NIP-07 extension or local nsec.

## Gift-wrapped messages (NIP-17)

NIP-17 wraps a kind:14 chat message in a kind:13 seal then a kind:1059 gift wrap. Use Applesauce's loaders / actions for this — search the Applesauce MCP (`applesauce_search_methods` for `giftwrap` or `nip17`) for the current API rather than implementing the wrapping/unwrapping by hand.

## Storage and display

- **Never log plaintext** — assume console output may be captured.
- **Decrypt lazily** — only when the user opens a thread, not eagerly on load.
- **Cache decrypted text in memory only**, not in IndexedDB or local storage, unless the cache itself is encrypted.
