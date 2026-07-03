# End-to-end tests (`e2e/`)

These tests exercise flows that genuinely need a **real git server** — anything
that pushes objects, reads packed refs, or relies on GRASP purgatory/state
semantics — by spinning up an [`ngit-grasp`][grasp] server and driving the
app's own git + Nostr libraries against it. They call the **production code
paths** directly (no mocks of the git/relay layers), so they catch
integration bugs unit tests can't.

They are **opt-in** and **excluded from the normal test run**:

- `pnpm test` / `npm test` and `pnpm pre-commit` / `npm run pre-commit` do
  **not** run them (the default Vitest config only includes `src/**`).
- Run them explicitly: `pnpm test:e2e` or `npm run test:e2e` (config:
  `vitest.e2e.config.ts`).
- Each suite gates itself on `graspBinaryAvailable()` — with no `ngit-grasp`
  binary present, suites **skip cleanly** instead of failing, so running this
  config anywhere is safe.

## Why this runs headless (no browser)

The git/relay layers use only Web-standard APIs that Node 22+ provides
natively:

- the git smart-HTTP wire protocol over `fetch`,
- object hashing via `crypto.subtle` + `TextEncoder`,
- the Nostr relay protocol over `WebSocket`.

So the tests run in Vitest's `node` environment — a real DOM would only get in
the way. This is also the constraint: **they cannot run anywhere that lacks the
`ngit-grasp` binary or a Node runtime** (e.g. a browser-only environment).

## Node-environment caveats for harness authors

Because production code normally runs in the browser, any module that touches a
**browser-only global must degrade cleanly when that global is absent in Node**
— otherwise the harness exercises a different (broken) path than production.

The canonical example: `src/lib/git-grasp-pool/cache.ts` guards `indexedDB`
(`typeof indexedDB === "undefined"`) and falls back to an L1-only in-memory
cache in Node. Without that guard, every cache read threw `ReferenceError:
indexedDB is not defined`, which surfaced upstream as spurious "could not reach
any clone URL" pool failures. If a new e2e flow hits a `ReferenceError` for a
DOM/Web-Storage global, fix it the same way: detect-and-degrade in the
production module, never stub it in the harness.

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

Keep this invariant in any new test: **import only from `e2e/harness` and the
pure `src/lib/git-*` / `src/factories/*` modules.** Never import the
`src/services/nostr.ts` singletons.

## Getting the binary

The harness locates `ngit-grasp` in this order:

1. `$NGIT_GRASP_BIN` — explicit path (set automatically by the Nix devShell;
   the binary is pinned via the `ngit-grasp` flake input, so `nix develop`
   gives a reproducible version).
2. `../ngit-grasp/target/release/ngit-grasp` — sibling-clone fallback for local
   dev (`cargo build --release` inside `../ngit-grasp`).

Set `NGIT_GRASP_DEBUG=1` to forward the grasp subprocess's stdout/stderr to the
test output when diagnosing a failure.

## Writing a new test

`e2e/harness/index.ts` is the source of truth for what the harness exposes
(server lifecycle, a raw relay client, a test signer, and repo/patch seeding
helpers). Read it rather than relying on a list here, which would go stale. A
minimal flow looks like:

```ts
import {
  GraspServer,
  RelayClient,
  TestSigner,
  seedRepo,
  graspBinaryAvailable,
} from "./harness";

const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

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

Each suite owns its own grasp subprocess on its own port; files run
sequentially (`fileParallelism: false`) to keep resource use predictable and
logs readable.

[grasp]: https://github.com/ — see `../ngit-grasp`
