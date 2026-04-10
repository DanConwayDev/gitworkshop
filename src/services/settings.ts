import { relaySet } from "applesauce-core/helpers";
import { BehaviorSubject, Observable, Subject, Subscription } from "rxjs";
import { map, distinctUntilChanged } from "rxjs/operators";

/**
 * Persists a BehaviorSubject or Subject to localStorage.
 * Loads initial value from localStorage if available.
 *
 * When `defaultValue` is provided the behaviour changes to "user-override only":
 *   - On load: restore from localStorage only if a saved value exists.
 *   - On change: if the new value equals the default (by serialized comparison),
 *     DELETE the localStorage key so future code-level default changes are
 *     automatically picked up by users who haven't customised the setting.
 *     Only write to localStorage when the value differs from the default.
 *
 * This means updating a default in code takes effect for all users who haven't
 * explicitly changed the setting, without needing a migration.
 *
 * @param subject - The subject to persist
 * @param key - localStorage key to use
 * @param options - Optional serializer/deserializer/defaultValue
 * @returns Subscription that can be unsubscribed to stop persisting
 *
 * @example
 * const theme = new BehaviorSubject<"light" | "dark">("light");
 * persist(theme, "theme", {
 *   serialize: (v) => v,
 *   deserialize: (v) => v as "light" | "dark",
 *   defaultValue: "light",
 * });
 */
export function persist<T>(
  subject: BehaviorSubject<T> | Subject<T>,
  key: string,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
    defaultValue?: T;
  },
): Subscription {
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? JSON.parse;
  const hasDefault = options !== undefined && "defaultValue" in options;
  const serializedDefault = hasDefault
    ? serialize(options.defaultValue as T)
    : undefined;

  // Load initial value from localStorage if available
  if (subject instanceof BehaviorSubject) {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      try {
        const parsed = deserialize(saved);
        subject.next(parsed);
      } catch (error) {
        console.warn(`Failed to load ${key} from localStorage:`, error);
        // Saved value is corrupt — remove it so the code default is used
        localStorage.removeItem(key);
      }
    }
  }

  // Subscribe to changes and persist to localStorage.
  // When a defaultValue is provided, delete the key instead of writing it
  // whenever the value matches the default — so code-level default changes
  // are picked up automatically by users who haven't customised the setting.
  return subject.subscribe((value) => {
    try {
      const serialized = serialize(value);
      if (hasDefault && serialized === serializedDefault) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, serialized);
      }
    } catch (error) {
      console.warn(`Failed to save ${key} to localStorage:`, error);
    }
  });
}

/**
 * Fallback relay list used when no other relay source is available.
 * Users can customize this in settings.
 */
export const DEFAULT_FALLBACK_RELAYS = relaySet([
  "wss://relay.ditto.pub",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
]);

export const fallbackRelays = new BehaviorSubject<string[]>(
  DEFAULT_FALLBACK_RELAYS,
);

// Persist the fallback relays to localStorage
persist(fallbackRelays, "extraRelays", {
  defaultValue: DEFAULT_FALLBACK_RELAYS,
});

/**
 * Returns an observable that emits true when the subject's current value
 * differs from the serialized default — i.e. the user has customised it.
 * Uses JSON serialization for comparison (same logic as `persist`).
 */
function isCustomised$<T>(
  subject: BehaviorSubject<T>,
  defaultValue: T,
): Observable<boolean> {
  const serializedDefault = JSON.stringify(defaultValue);
  return subject.pipe(
    map((v) => JSON.stringify(v) !== serializedDefault),
    distinctUntilChanged(),
  );
}

/** True when the user has customised the fallback relay list. */
export const fallbackRelaysCustomised$ = isCustomised$(
  fallbackRelays,
  DEFAULT_FALLBACK_RELAYS,
);

/**
 * Lookup relays for finding user relay hints (NIP-65, profile relays, etc.)
 * These are used by the event loaders to find events more efficiently.
 */
export const DEFAULT_LOOKUP_RELAYS = relaySet([
  "wss://purplepag.es/",
  "wss://index.hzrd149.com/",
  "wss://indexer.coracle.social/",
]);

export const lookupRelays = new BehaviorSubject<string[]>(
  DEFAULT_LOOKUP_RELAYS,
);

// Persist the lookup relays to localStorage
persist(lookupRelays, "lookupRelays", { defaultValue: DEFAULT_LOOKUP_RELAYS });

/** True when the user has customised the lookup relay list. */
export const lookupRelaysCustomised$ = isCustomised$(
  lookupRelays,
  DEFAULT_LOOKUP_RELAYS,
);

/**
 * Git index relays — store repository announcements (kind 30617) across the
 * network. Used for discovering repositories published via ngit.
 */
export const DEFAULT_GIT_INDEX_RELAYS = relaySet(["wss://index.ngit.dev"]);

export const gitIndexRelays = new BehaviorSubject<string[]>(
  DEFAULT_GIT_INDEX_RELAYS,
);

// Persist the git index relays to localStorage
persist(gitIndexRelays, "gitIndexRelays", {
  defaultValue: DEFAULT_GIT_INDEX_RELAYS,
});

/** True when the user has customised the git index relay list. */
export const gitIndexRelaysCustomised$ = isCustomised$(
  gitIndexRelays,
  DEFAULT_GIT_INDEX_RELAYS,
);

/**
 * Relay curation mode.
 *
 * - "repo"   (default): Repo Relay Event Curation — only query the relays
 *   declared in the repository announcement plus maintainer mailbox relays
 *   discovered via the repo's own relay list. Keeps traffic focused and
 *   predictable.
 *
 * - "outbox": Full Nostr Outbox Model — additionally follows each maintainer's
 *   NIP-65 outbox and inbox relays when fetching issues, patches, and comments.
 *   More complete but generates more relay connections.
 */
export type RelayCurationMode = "repo" | "outbox";

const DEFAULT_RELAY_CURATION_MODE: RelayCurationMode = "repo";

export const relayCurationMode = new BehaviorSubject<RelayCurationMode>(
  DEFAULT_RELAY_CURATION_MODE,
);

// Persist the relay curation mode to localStorage
persist(relayCurationMode, "relayCurationMode", {
  serialize: (v) => v,
  deserialize: (v) => (v === "outbox" ? "outbox" : "repo"),
  defaultValue: DEFAULT_RELAY_CURATION_MODE,
});

// ---------------------------------------------------------------------------
// Remote signer (NIP-46) relays
// ---------------------------------------------------------------------------

/**
 * Default rendezvous relays used when initiating a new remote-signer
 * (NIP-46 / nostrconnect) session. Matches the defaults used by the ngit CLI
 * (wss://bucket.coracle.social, wss://nos.lol, wss://relay.ditto.pub).
 *
 * These relays are negotiated at connection time and stored in the bunker URI —
 * changing this setting only affects *new* remote-signer logins. Existing
 * accounts continue to use the relays embedded in their bunker URI.
 */
export const DEFAULT_NOSTR_CONNECT_RELAYS: readonly string[] = [
  "wss://bucket.coracle.social",
  "wss://nos.lol",
  "wss://relay.ditto.pub",
];

export const defaultNostrConnectRelays = new BehaviorSubject<string[]>([
  ...DEFAULT_NOSTR_CONNECT_RELAYS,
]);

// Persist user overrides; delete the key when the value matches the default so
// code-level default changes are picked up by users who haven't customised it.
persist(defaultNostrConnectRelays, "defaultNostrConnectRelays", {
  defaultValue: [...DEFAULT_NOSTR_CONNECT_RELAYS],
});

/** True when the user has customised the default remote signer relay list. */
export const nostrConnectRelaysCustomised$ = isCustomised$(
  defaultNostrConnectRelays,
  [...DEFAULT_NOSTR_CONNECT_RELAYS],
);

// ---------------------------------------------------------------------------
// Default Grasp servers
// ---------------------------------------------------------------------------

/**
 * Default Grasp server domains used when a user has no kind:10317 grasp list.
 * Matches the defaults in ngit CLI (relay.ngit.dev and gitnostr.com).
 *
 * These are bare domains — the WebSocket URL is `wss://<domain>` and the
 * git HTTP URL is `https://<domain>/<npub>/<repo-id>.git`.
 */
export const DEFAULT_GRASP_SERVERS: readonly string[] = [
  "relay.ngit.dev",
  "gitnostr.com",
];

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(t: "light" | "dark") {
  if (t === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export const theme = new BehaviorSubject<"light" | "dark">(getSystemTheme());

// Apply theme class on every change
theme.subscribe(applyTheme);

// Persist user preference; omit key when it matches the system default so
// future system-theme changes are respected by users who haven't customised it.
persist(theme, "theme", {
  serialize: (v) => v,
  deserialize: (v) => (v === "light" || v === "dark" ? v : getSystemTheme()),
});

export function toggleTheme() {
  theme.next(theme.getValue() === "dark" ? "light" : "dark");
}
