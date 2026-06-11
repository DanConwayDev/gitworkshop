/**
 * GraspServer — spawn a real `ngit-grasp` subprocess for e2e tests.
 *
 * This is the JavaScript counterpart to ngit's Rust test harness
 * (`../ngit/test_harness/src/grasp.rs`). It spawns the actual `ngit-grasp`
 * binary in in-memory test mode on a loopback port and waits for it to accept
 * connections.
 *
 * Why a real subprocess (not a mock):
 *   The merge button's git layer (`git-push.ts`, `git-packfile.ts`,
 *   `git-http.ts`) speaks the real git smart-HTTP wire protocol over `fetch`,
 *   and the publish layer speaks the real Nostr relay protocol over WebSocket.
 *   Both run unmodified under Node, so exercising them against a real grasp
 *   server is the only way to catch protocol/packfile/purgatory bugs that a
 *   mock would paper over.
 *
 * ## Binary discovery (same contract as the Rust harness)
 *
 *   1. `$NGIT_GRASP_BIN` — explicit override (preferred; set by the flake).
 *   2. `<repo-parent>/ngit-grasp/target/release/ngit-grasp` — sibling-clone
 *      fallback for local dev.
 *   3. Throw with a clear error.
 *
 * ## Lifecycle
 *
 *   const server = await GraspServer.start();
 *   // ... use server.httpUrl / server.relayUrl ...
 *   await server.stop();
 *
 * Always `stop()` in an `afterAll`/`afterEach` — the subprocess and its
 * tempdir are cleaned up there.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

/** How long to wait for ngit-grasp to accept TCP connections before giving up. */
const READY_TIMEOUT_MS = 15_000;
/** Poll interval for the readiness probe. */
const READY_POLL_MS = 100;
/**
 * Grace period after the first successful HTTP response, mirroring the Rust
 * harness. The relay listener accepts before the websocket handler is fully
 * wired; without this the first REQ can race the binding.
 */
const READY_GRACE_MS = 150;

export interface GraspServerOptions {
  /** Role label for debugging (e.g. "repo", "fork"). Default: "grasp". */
  role?: string;
  /** Enable the GRASP-06 `/prs/` endpoint (NGIT_GRASP06_ENABLE=true). */
  grasp06?: boolean;
}

export class GraspServer {
  private constructor(
    readonly role: string,
    readonly port: number,
    private readonly process: ChildProcess,
    private readonly gitDataPath: string,
  ) {}

  /** `http://127.0.0.1:<port>` — used as a clone URL base. */
  get httpUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** `ws://127.0.0.1:<port>` — the Nostr relay endpoint. */
  get relayUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  /** Hostname:port form — matches what announcements embed for grasp domains. */
  get hostPort(): string {
    return `127.0.0.1:${this.port}`;
  }

  /**
   * The git clone URL for a repo with the given d-tag owned by `npub`.
   *
   * Grasp lays out bare repos at `<root>/<npub>/<identifier>.git` and serves
   * them over HTTP at `http://<host>/<npub>/<identifier>.git`.
   */
  cloneUrl(npub: string, identifier: string): string {
    return `${this.httpUrl}/${npub}/${identifier}.git`;
  }

  /** Root dir under which grasp creates bare repos (`<root>/<npub>/<id>.git`). */
  get dataDir(): string {
    return this.gitDataPath;
  }

  /**
   * Spawn ngit-grasp, wait until it accepts connections, and return it.
   *
   * @throws if the binary cannot be located or the server never becomes ready.
   */
  static async start(options: GraspServerOptions = {}): Promise<GraspServer> {
    const role = options.role ?? "grasp";
    const binary = locateBinary();
    const port = await reservePort();
    const bind = `127.0.0.1:${port}`;
    const gitDataDir = mkdtempSync(join(tmpdir(), `grasp-${role}-`));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NGIT_BIND_ADDRESS: bind,
      NGIT_DOMAIN: bind,
      NGIT_GIT_DATA_PATH: gitDataDir,
      NGIT_DATABASE_BACKEND: "memory",
      NGIT_TEST: "1",
      NGIT_SYNC_STARTUP_DELAY_SECS: "0",
      NGIT_SYNC_STARTUP_JITTER_MS: "0",
      NGIT_SYNC_DISCONNECT_CHECK_INTERVAL_SECS: "1",
    };
    if (options.grasp06) env.NGIT_GRASP06_ENABLE = "true";

    const child = spawn(binary, [], {
      cwd: gitDataDir,
      env,
      // Detach from the test's stdio — INFO output makes test logs unreadable.
      // Capture is opt-in via NGIT_GRASP_DEBUG for diagnosing failures.
      stdio: process.env.NGIT_GRASP_DEBUG
        ? ["ignore", "inherit", "inherit"]
        : "ignore",
    });

    const server = new GraspServer(role, port, child, gitDataDir);

    let exited: number | null = null;
    child.once("exit", (code) => {
      exited = code ?? -1;
    });

    try {
      await server.waitForReady(() => exited);
    } catch (err) {
      await server.stop();
      throw err;
    }
    return server;
  }

  private async waitForReady(getExitCode: () => number | null): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const code = getExitCode();
      if (code !== null) {
        throw new Error(
          `ngit-grasp (${this.role}) exited before becoming ready ` +
            `(code ${code}). Set NGIT_GRASP_DEBUG=1 to see its logs.`,
        );
      }
      try {
        const res = await fetch(this.httpUrl + "/", { method: "GET" });
        // Any HTTP response means the listener is up.
        void res.text().catch(() => undefined);
        await sleep(READY_GRACE_MS);
        return;
      } catch {
        await sleep(READY_POLL_MS);
      }
    }
    throw new Error(
      `ngit-grasp (${this.role}) at ${this.hostPort} did not become ready ` +
        `within ${READY_TIMEOUT_MS}ms`,
    );
  }

  /** Kill the subprocess and remove its tempdir. Safe to call multiple times. */
  async stop(): Promise<void> {
    if (!this.process.killed && this.process.exitCode === null) {
      this.process.kill("SIGKILL");
      // Give the OS a tick to reap; not strictly required for correctness.
      await sleep(50);
    }
    try {
      rmSync(this.gitDataPath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Reserve a free loopback TCP port by binding to port 0 and reading back the
 * assigned port, then releasing it. There is a small TOCTOU window between
 * release and ngit-grasp's own bind, but it is negligible in practice and
 * matches the approach the Rust harness documents.
 */
function reservePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => res(port));
      } else {
        srv.close(() => rej(new Error("failed to read reserved port")));
      }
    });
  });
}

function locateBinary(): string {
  const fromEnv = process.env.NGIT_GRASP_BIN;
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    throw new Error(
      `NGIT_GRASP_BIN points to "${fromEnv}" but no file exists there. ` +
        `Build ngit-grasp or fix the path.`,
    );
  }

  // Sibling-clone fallback: <repo-parent>/ngit-grasp/target/release/ngit-grasp
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");
  const repoParent = resolve(repoRoot, "..");
  const sibling = join(
    repoParent,
    "ngit-grasp",
    "target",
    "release",
    "ngit-grasp",
  );
  if (existsSync(sibling)) return sibling;

  throw new Error(
    `ngit-grasp binary not found. Either set NGIT_GRASP_BIN to the binary ` +
      `path, or build a sibling clone at ${sibling} ` +
      `(cargo build --release inside ../ngit-grasp).`,
  );
}

/** True when an ngit-grasp binary is available — gate e2e suites on this. */
export function graspBinaryAvailable(): boolean {
  try {
    locateBinary();
    return true;
  } catch {
    return false;
  }
}
