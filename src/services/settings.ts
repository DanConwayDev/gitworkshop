import { relaySet } from "applesauce-core/helpers";
import { BehaviorSubject, Subject, Subscription } from "rxjs";

/**
 * Persists a BehaviorSubject or Subject to localStorage.
 * Loads initial value from localStorage if available.
 *
 * @param subject - The subject to persist
 * @param key - localStorage key to use
 * @param options - Optional serializer/deserializer functions
 * @returns Subscription that can be unsubscribed to stop persisting
 *
 * @example
 * const theme = new BehaviorSubject<"light" | "dark">("light");
 * persist(theme, "theme", {
 *   serialize: (v) => v,
 *   deserialize: (v) => v as "light" | "dark"
 * });
 */
export function persist<T>(
  subject: BehaviorSubject<T> | Subject<T>,
  key: string,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
  },
): Subscription {
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? JSON.parse;

  // Load initial value from localStorage if available
  if (subject instanceof BehaviorSubject) {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      try {
        const parsed = deserialize(saved);
        subject.next(parsed);
      } catch (error) {
        console.warn(`Failed to load ${key} from localStorage:`, error);
      }
    }
  }

  // Subscribe to changes and persist to localStorage
  return subject.subscribe((value) => {
    try {
      localStorage.setItem(key, serialize(value));
    } catch (error) {
      console.warn(`Failed to save ${key} to localStorage:`, error);
    }
  });
}

/**
 * Default relay list for querying events.
 * Users can customize this in settings.
 */
export const extraRelays = new BehaviorSubject<string[]>(
  relaySet(["wss://relay.ditto.pub", "wss://relay.damus.io"]),
);

// Persist the extra relays to localStorage
persist(extraRelays, "extraRelays");

/**
 * Lookup relays for finding user relay hints (NIP-65, profile relays, etc.)
 * These are used by the event loaders to find events more efficiently.
 */
export const lookupRelays = new BehaviorSubject<string[]>(
  relaySet([
    "wss://purplepag.es/",
    "wss://index.hzrd149.com/",
    "wss://indexer.coracle.social/",
  ]),
);

// Persist the lookup relays to localStorage
persist(lookupRelays, "lookupRelays");
