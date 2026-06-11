# End-to-end tests (`e2e/`)

These tests exercise flows that genuinely need a **git server** — most notably
the **Merge button** — by spinning up a real [`ngit-grasp`][grasp] server and
driving the app's own git + Nostr libraries against it.

They are **opt-in** and **excluded from the normal test run**:

- `pnpm test` and `pnpm pre-commit` do **not** run them.
- Run them explicitly: `pnpm test:e2e`.
- Each suite gates itself on `graspBinaryAvailable()` — if no `ngit-grasp`
  binary is found, the suite **skips cleanly** instead of failing.

## Why this works without a browser

The merge pipeline is environment-agnostic:

- `src/lib/git-push.ts`, `git-packfile.ts`, `git-http.ts` speak the real git
  smart-HTTP wire protocol over `fetch`.
- Object hashing uses `crypto.subtle` + `TextEncoder`.
- Publishing uses the Nostr relay protocol over `WebSocket`.

Node 22+ provides all of these natively, so the tests run in Vitest's `node`
environment (`vitest.e2e.config.ts`) and call the **production code paths**
directly — no mocks of the git/relay layers.

## No production side-effects — by construction

The harness **never** imports `src/services/nostr.ts` (`pool`, `eventStore`,
`outboxStore`, `publish`). Those resolve relay groups against production
fallback/index relays. Instead:

- `RelayClient` is a **raw WebSocket** client pointed at a single relay URL.
  The only URL it is ever given is the local grasp server's, so there is no
  code path that can reach a production relay.
- `GraspServer` binds to `127.0.0.1` on an ephemeral port with an in-memory
  database (`NGIT_DATABASE_BACKEND=memory`) and a tempdir for git data, both
  torn down in `stop()`.

If you write a new e2e test, keep this invariant: **import only from
`e2e/harness` and the pure `src/lib/git-*` / `src/factories/*` modules.** Never
import the `src/services/nostr.ts` singletons.

## Getting the binary

The harness locates `ngit-grasp` in this order:

1. `$NGIT_GRASP_BIN` — explicit path (set automatically by the Nix devShell).
2. `../ngit-grasp/target/release/ngit-grasp` — sibling-clone fallback for local
   dev (`cargo build --release` inside `../ngit-grasp`).

Set `NGIT_GRASP_DEBUG=1` to forward the grasp subprocess's stdout/stderr to the
test output when diagnosing a failure.

## Harness API

```ts
import {
  GraspServer,
  RelayClient,
  TestSigner,
  seedRepo,
  graspBinaryAvailable,
} from "./harness";

const server = await GraspServer.start();
const relay = await RelayClient.connect(server.relayUrl);
const maintainer = new TestSigner();

// announce → state → push initial commit
const repo = await seedRepo(server, relay, maintainer, {
  identifier: "demo",
  files: { "README.md": "# demo\n" },
});

// ... drive the flow under test, then assert against the relay / git server ...

relay.close();
await server.stop();
```

[grasp]: https://github.com/ — see `../ngit-grasp`
