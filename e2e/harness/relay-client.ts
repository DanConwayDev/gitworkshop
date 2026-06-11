/**
 * relay-client — a minimal raw-WebSocket Nostr relay client for e2e tests.
 *
 * Deliberately does NOT use the app's `pool` / `outboxStore` / `eventStore`
 * singletons from `src/services/nostr.ts`. Those resolve relay groups against
 * production fallback / index relays and would publish test events to the real
 * network. By talking directly to a known relay URL over a raw WebSocket, a
 * test can ONLY ever reach the local grasp server it was given — there is no
 * code path to a production relay.
 *
 * Implements just enough of NIP-01 for the harness:
 *   - publish(): EVENT → wait for OK
 *   - query():   REQ → collect events until EOSE
 *   - waitForEvent(): REQ (live) → resolve on first matching event
 */

import type { Filter, NostrEvent } from "nostr-tools";

/** Default time to wait for an OK / EOSE before giving up. */
const DEFAULT_TIMEOUT_MS = 10_000;

interface OkResponse {
  ok: boolean;
  message: string;
}

/**
 * A single open connection to one relay. Create with `RelayClient.connect`,
 * always `close()` when done (e.g. in `afterAll`).
 */
export class RelayClient {
  private constructor(
    readonly url: string,
    private readonly ws: WebSocket,
  ) {}

  static connect(
    url: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<RelayClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`timed out connecting to relay ${url}`));
      }, timeoutMs);

      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new RelayClient(url, ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`failed to connect to relay ${url}`));
      });
    });
  }

  /**
   * Publish an event and wait for the relay's OK message.
   *
   * @throws if the relay rejects the event (OK false) or times out.
   */
  publish(
    event: NostrEvent,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<OkResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.removeEventListener("message", onMessage);
        reject(
          new Error(
            `timed out waiting for OK on event ${event.id} from ${this.url}`,
          ),
        );
      }, timeoutMs);

      const onMessage = (ev: MessageEvent) => {
        const msg = parseMessage(ev.data);
        if (msg && msg[0] === "OK" && msg[1] === event.id) {
          clearTimeout(timer);
          this.ws.removeEventListener("message", onMessage);
          const ok = msg[2] === true;
          const message = typeof msg[3] === "string" ? msg[3] : "";
          if (!ok) {
            reject(
              new Error(
                `relay ${this.url} rejected event ${event.id}: ${message}`,
              ),
            );
          } else {
            resolve({ ok, message });
          }
        }
      };

      this.ws.addEventListener("message", onMessage);
      this.ws.send(JSON.stringify(["EVENT", event]));
    });
  }

  /**
   * Run a one-shot REQ and collect all events until EOSE.
   *
   * @returns the events received before EOSE.
   */
  query(
    filters: Filter[],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<NostrEvent[]> {
    return new Promise((resolve, reject) => {
      const subId = randomId();
      const collected: NostrEvent[] = [];

      const timer = setTimeout(() => {
        cleanup();
        // Resolve with whatever we have on timeout rather than rejecting —
        // some relays are slow to send EOSE. Tests assert on contents.
        resolve(collected);
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.ws.removeEventListener("message", onMessage);
        try {
          this.ws.send(JSON.stringify(["CLOSE", subId]));
        } catch {
          // socket may already be closing
        }
      };

      const onMessage = (ev: MessageEvent) => {
        const msg = parseMessage(ev.data);
        if (!msg) return;
        if (msg[0] === "EVENT" && msg[1] === subId) {
          collected.push(msg[2] as NostrEvent);
        } else if (msg[0] === "EOSE" && msg[1] === subId) {
          cleanup();
          resolve(collected);
        } else if (msg[0] === "CLOSED" && msg[1] === subId) {
          cleanup();
          reject(new Error(`relay ${this.url} closed sub: ${msg[2]}`));
        }
      };

      this.ws.addEventListener("message", onMessage);
      this.ws.send(JSON.stringify(["REQ", subId, ...filters]));
    });
  }

  /**
   * Open a live REQ and resolve as soon as one event matching `predicate`
   * arrives (after the historical EOSE or during it). Useful for asserting an
   * event the server *derives* (e.g. a synced state) eventually appears.
   */
  waitForEvent(
    filters: Filter[],
    predicate: (e: NostrEvent) => boolean = () => true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<NostrEvent> {
    return new Promise((resolve, reject) => {
      const subId = randomId();
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `timed out waiting for matching event from ${this.url} ` +
              `(filters: ${JSON.stringify(filters)})`,
          ),
        );
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.ws.removeEventListener("message", onMessage);
        try {
          this.ws.send(JSON.stringify(["CLOSE", subId]));
        } catch {
          // ignore
        }
      };

      const onMessage = (ev: MessageEvent) => {
        const msg = parseMessage(ev.data);
        if (!msg) return;
        if (msg[0] === "EVENT" && msg[1] === subId) {
          const event = msg[2] as NostrEvent;
          if (predicate(event)) {
            cleanup();
            resolve(event);
          }
        }
      };

      this.ws.addEventListener("message", onMessage);
      this.ws.send(JSON.stringify(["REQ", subId, ...filters]));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

function parseMessage(data: unknown): unknown[] | null {
  try {
    const text = typeof data === "string" ? data : String(data);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2);
}
