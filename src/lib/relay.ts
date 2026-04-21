/**
 * Shared relay subscription helpers.
 */

import { timer } from "rxjs";

/**
 * Exponential backoff retry config for persistent relay subscriptions.
 *
 * Use this instead of `reconnect: Infinity` (which retries every 1 s by
 * default). Dead or 404 relays would otherwise hammer the network; with
 * backoff the delay grows: 1 s → 2 s → 4 s → 8 s … capped at 5 minutes.
 *
 * Compatible with the `reconnect` option of applesauce-relay's
 * `SubscriptionOptions`, which passes it straight to RxJS `retry()`.
 */
export const BACKOFF_RECONNECT = {
  count: Infinity as number,
  delay: (_err: unknown, retryCount: number) =>
    timer(Math.min(1000 * Math.pow(2, retryCount - 1), 5 * 60_000)),
};
