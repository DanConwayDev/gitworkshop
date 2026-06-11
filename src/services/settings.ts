import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  combineLatest,
} from "rxjs";
import { map, distinctUntilChanged } from "rxjs/operators";
import { normalizeUrl } from "@/lib/url";

/** Normalize and deduplicate a list of relay URLs. */
function normalizeRelayList(urls: readonly string[]): string[] {
  return [...new Set(urls.map(normalizeUrl))];
}

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
export const DEFAULT_FALLBACK_RELAYS = normalizeRelayList([
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
  deserialize: (v) => normalizeRelayList(JSON.parse(v) as string[]),
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
export const DEFAULT_LOOKUP_RELAYS = normalizeRelayList([
  "wss://purplepag.es",
  "wss://index.hzrd149.com",
  "wss://indexer.coracle.social",
]);

export const lookupRelays = new BehaviorSubject<string[]>(
  DEFAULT_LOOKUP_RELAYS,
);

// Persist the lookup relays to localStorage
persist(lookupRelays, "lookupRelays", {
  deserialize: (v) => normalizeRelayList(JSON.parse(v) as string[]),
  defaultValue: DEFAULT_LOOKUP_RELAYS,
});

/** True when the user has customised the lookup relay list. */
export const lookupRelaysCustomised$ = isCustomised$(
  lookupRelays,
  DEFAULT_LOOKUP_RELAYS,
);

/**
 * Git index relays — store repository announcements (kind 30617) across the
 * network. Used for discovering repositories published via ngit.
 */
export const DEFAULT_GIT_INDEX_RELAYS = normalizeRelayList([
  "wss://index.ngit.dev",
]);

export const gitIndexRelays = new BehaviorSubject<string[]>(
  DEFAULT_GIT_INDEX_RELAYS,
);

// Persist the git index relays to localStorage
persist(gitIndexRelays, "gitIndexRelays", {
  deserialize: (v) => normalizeRelayList(JSON.parse(v) as string[]),
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

const DEFAULT_RELAY_CURATION_MODE: RelayCurationMode = "outbox";

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
  "wss://relay.primal.net",
  "wss://nrs.primal.net",
];

export const defaultNostrConnectRelays = new BehaviorSubject<string[]>(
  normalizeRelayList(DEFAULT_NOSTR_CONNECT_RELAYS),
);

// Persist user overrides; delete the key when the value matches the default so
// code-level default changes are picked up by users who haven't customised it.
persist(defaultNostrConnectRelays, "defaultNostrConnectRelays", {
  deserialize: (v) => normalizeRelayList(JSON.parse(v) as string[]),
  defaultValue: normalizeRelayList(DEFAULT_NOSTR_CONNECT_RELAYS),
});

/** True when the user has customised the default remote signer relay list. */
export const nostrConnectRelaysCustomised$ = isCustomised$(
  defaultNostrConnectRelays,
  normalizeRelayList(DEFAULT_NOSTR_CONNECT_RELAYS),
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

/**
 * What the user picks. "system" follows the OS via prefers-color-scheme and
 * tracks changes live; "light" and "dark" are explicit overrides.
 */
export type ThemeMode = "light" | "dark" | "system";

/** What actually applies to the DOM after resolving "system". */
export type ResolvedTheme = "light" | "dark";

function readStoredMode(): ThemeMode {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function applyTheme(t: ResolvedTheme) {
  if (t === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

/** The user's selected mode. Read this for UI state (icon, dropdown value). */
export const themeMode = new BehaviorSubject<ThemeMode>(readStoredMode());

// Tracks the OS preference live. matchMedia fires whenever the user flips
// their system theme — when mode is "system" this propagates to the app
// without needing a reload.
const systemMql = window.matchMedia("(prefers-color-scheme: dark)");
export const systemTheme = new BehaviorSubject<ResolvedTheme>(
  systemMql.matches ? "dark" : "light",
);
systemMql.addEventListener("change", (e) => {
  systemTheme.next(e.matches ? "dark" : "light");
});

/** What's actually painted. Subscribe to this to react to theme changes. */
export const resolvedTheme: Observable<ResolvedTheme> = combineLatest([
  themeMode,
  systemTheme,
]).pipe(
  map(([mode, sys]) => (mode === "system" ? sys : mode)),
  distinctUntilChanged(),
);

resolvedTheme.subscribe(applyTheme);

// Persist the user's mode. `defaultValue: "system"` makes persist() DELETE
// the localStorage key whenever the user picks "system" again — so they go
// back to following the OS instead of being locked into a snapshot of it.
persist(themeMode, "theme", {
  serialize: (v) => v,
  deserialize: (v) =>
    v === "light" || v === "dark" || v === "system" ? v : "system",
  defaultValue: "system",
});

export function setThemeMode(mode: ThemeMode) {
  themeMode.next(mode);
}

/**
 * Cycle order adapts to the current OS theme so clicking from system always
 * produces a visible change (never lands on the same resolved colour):
 *   OS=light:  system → dark → light → system
 *   OS=dark:   system → light → dark → system
 */
export function cycleThemeMode() {
  const current = themeMode.getValue();
  const osDark = systemMql.matches;
  if (current === "system") {
    themeMode.next(osDark ? "light" : "dark");
  } else if (current === "light") {
    themeMode.next(osDark ? "dark" : "system");
  } else {
    themeMode.next(osDark ? "system" : "light");
  }
}
