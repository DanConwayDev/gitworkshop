/**
 * e2e setup — runs before any e2e test module is imported.
 *
 * Intentionally minimal. The harness (`e2e/harness/`) is decoupled from the
 * `@/services/nostr` singleton graph and from browser-only globals: it imports
 * only the pure `@/lib/git-*` modules (which use Web-standard `fetch`,
 * `crypto.subtle`, `TextEncoder` — all native in Node 22+) plus `nostr-tools`.
 *
 * If a future e2e test imports an app module that touches browser globals at
 * load time, add the minimal polyfill here rather than reaching for jsdom —
 * keeping the environment `node` is what lets the real `fetch`/`WebSocket`
 * paths run against the grasp server.
 */

export {};
