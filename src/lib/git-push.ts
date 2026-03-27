/**
 * git-push --- git smart HTTP send-pack protocol.
 *
 * Implements the client side of the git smart HTTP send-pack protocol for
 * pushing objects to a git server. This is the mirror image of the
 * upload-pack (fetch) protocol implemented in git-http.ts.
 *
 * Protocol flow:
 *   1. GET  /<repo>/info/refs?service=git-receive-pack   (discover refs)
 *   2. POST /<repo>/git-receive-pack                     (send updates + packfile)
 *
 * Designed for browser use (no Node.js APIs). Works directly with Grasp
 * servers (which serve CORS headers natively) without a CORS proxy.
 *
 * References:
 *   - https://github.com/git/git/blob/master/Documentation/gitprotocol-http.adoc
 *   - https://github.com/git/git/blob/master/Documentation/gitprotocol-pack.adoc
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed response from GET info/refs?service=git-receive-pack. */
export interface InfoRefsReceivePackResponse {
  /** Map of refname to commit hash. */
  refs: Record<string, string>;
  /** Server-advertised capabilities. */
  capabilities: string[];
}

/** A ref update to send to the server. */
export interface RefUpdate {
  /** Current hash on the server (use ZERO_HASH for new refs). */
  oldHash: string;
  /** New hash to set (use ZERO_HASH for deletions). */
  newHash: string;
  /** Full ref name, e.g. "refs/heads/main" or "refs/nostr/<event-id>". */
  refName: string;
}

/** Per-ref result from the server's report-status response. */
export interface RefResult {
  refName: string;
  ok: boolean;
  /** Error reason if not ok. */
  reason?: string;
}

/** Result of a push operation. */
export interface PushResult {
  /** Whether the overall unpack succeeded. */
  unpackOk: boolean;
  /** Per-ref results. */
  refResults: RefResult[];
  /** Raw response text for debugging. */
  rawResponse: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The zero hash used for new refs or deletions. */
export const ZERO_HASH = "0000000000000000000000000000000000000000";

/**
 * Capabilities we request from the server when pushing.
 * We only request capabilities the server actually advertises.
 */
const WANTED_CAPABILITIES = ["report-status", "delete-refs"] as const;

// ---------------------------------------------------------------------------
// pkt-line encoding / decoding
// ---------------------------------------------------------------------------

/**
 * Encode a string as a pkt-line (4-byte hex length prefix + data).
 *
 * The length prefix includes itself (4 bytes) plus the data length.
 * An empty data string produces a flush packet ("0000").
 *
 * @param data - The string payload to encode
 * @returns The pkt-line encoded string
 */
export function pktLineEncode(data: string): string {
  if (data.length === 0) return "0000";
  const len = data.length + 4;
  return len.toString(16).padStart(4, "0") + data;
}

/**
 * Encode a flush packet.
 *
 * A flush packet is the special pkt-line "0000" that signals the end of a
 * section in the git protocol.
 *
 * @returns The flush packet string "0000"
 */
export function pktLineFlush(): string {
  return "0000";
}

/**
 * Parse pkt-line formatted response data into individual lines.
 *
 * Handles:
 *   - Standard pkt-lines with 4-byte hex length prefix
 *   - Flush packets ("0000") which are returned as empty strings
 *   - Side-band-64k channel prefixes (strips the channel byte)
 *
 * @param data - Raw pkt-line formatted string
 * @returns Array of decoded line contents (without length prefixes)
 */
export function parsePktLines(data: string): string[] {
  const lines: string[] = [];
  let pos = 0;

  while (pos < data.length) {
    // Need at least 4 characters for the length prefix
    if (pos + 4 > data.length) break;

    const lenHex = data.substring(pos, pos + 4);
    const len = parseInt(lenHex, 16);

    // Flush packet
    if (len === 0) {
      lines.push("");
      pos += 4;
      continue;
    }

    // Malformed length
    if (isNaN(len) || len < 4) break;

    // Extract the payload (length includes the 4-byte prefix itself)
    const payload = data.substring(pos + 4, pos + len);
    lines.push(payload);
    pos += len;
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Side-band-64k handling
// ---------------------------------------------------------------------------

/**
 * Strip side-band-64k channel prefixes from pkt-line payloads.
 *
 * Side-band-64k wraps each pkt-line payload with a single channel byte:
 *   - Channel 1 (\x01): pack data (ignored for report-status parsing)
 *   - Channel 2 (\x02): progress messages (ignored)
 *   - Channel 3 (\x03): error messages (collected)
 *
 * Returns only the channel-1 text content (report-status lines).
 *
 * @param lines - Parsed pkt-line payloads (from parsePktLines)
 * @returns Lines with side-band prefixes stripped, only channel 1 content
 */
export function stripSideBand(lines: string[]): string[] {
  const result: string[] = [];

  for (const line of lines) {
    // Flush packets pass through
    if (line === "") {
      result.push("");
      continue;
    }

    const channelByte = line.charCodeAt(0);

    // Channel 1: pack data / report-status
    if (channelByte === 1) {
      result.push(line.substring(1));
      continue;
    }

    // Channel 2: progress (ignore)
    if (channelByte === 2) continue;

    // Channel 3: error
    if (channelByte === 3) {
      throw new Error(`git server error: ${line.substring(1).trim()}`);
    }

    // No side-band prefix --- treat as plain content
    result.push(line);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Detect whether pkt-line payloads use side-band-64k encoding.
 *
 * Heuristic: if the first non-empty, non-flush line starts with \x01, \x02,
 * or \x03, the response is side-band wrapped.
 */
function isSideBandEncoded(lines: string[]): boolean {
  for (const line of lines) {
    if (line === "") continue;
    const ch = line.charCodeAt(0);
    return ch === 1 || ch === 2 || ch === 3;
  }
  return false;
}

/**
 * Parse the info/refs response for git-receive-pack.
 *
 * Response format (pkt-line encoded):
 *   - Service announcement: "# service=git-receive-pack\n"
 *   - Flush packet
 *   - First ref line with capabilities after \0
 *   - Subsequent ref lines: "<hash> <refname>\n"
 *   - Flush packet
 *
 * @param responseText - Raw response body text
 * @returns Parsed refs and capabilities
 */
export function parseInfoRefsResponse(
  responseText: string,
): InfoRefsReceivePackResponse {
  const result: InfoRefsReceivePackResponse = {
    refs: {},
    capabilities: [],
  };

  const lines = responseText.split("\n").filter((line) => line.length > 0);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip flush packets embedded in the line
    if (line.startsWith("0000")) line = line.slice(4);

    // Parse pkt-line length prefix
    const length = parseInt(line.substring(0, 4), 16);
    if (isNaN(length) || length === 0) continue;

    const content = line.substring(4, length);

    // Skip service announcement
    if (content.startsWith("# service=")) continue;

    // Parse ref lines: "<hash> <refname>[\0<capabilities>]"
    if (content.includes(" ")) {
      const parts = content.split(" ");
      const hash = parts[0];
      const refAndCaps = parts.slice(1).join(" ");

      if (refAndCaps.includes("\0")) {
        // First ref line with capabilities
        const [ref, capsString] = refAndCaps.split("\0");
        const trimmedRef = ref.trim();
        if (trimmedRef) {
          result.refs[trimmedRef] = hash;
        }
        result.capabilities = capsString
          .trim()
          .split(" ")
          .filter((c) => c.length > 0);
      } else {
        const trimmedRef = refAndCaps.trim();
        if (trimmedRef) {
          result.refs[trimmedRef] = hash;
        }
      }
    }
  }

  return result;
}

/**
 * Parse the report-status response from git-receive-pack.
 *
 * Response format (pkt-line encoded, possibly side-band-64k wrapped):
 *   - "unpack ok\n" or "unpack <error>\n"
 *   - For each ref: "ok <refname>\n" or "ng <refname> <reason>\n"
 *   - Flush packet
 *
 * @param responseText - Raw response body text
 * @returns Parsed push result
 */
export function parseReportStatus(responseText: string): PushResult {
  const result: PushResult = {
    unpackOk: false,
    refResults: [],
    rawResponse: responseText,
  };

  let pktLines = parsePktLines(responseText);

  // Handle side-band-64k encoding
  if (isSideBandEncoded(pktLines)) {
    pktLines = stripSideBand(pktLines);
  }

  for (const line of pktLines) {
    // Skip flush packets
    if (line === "") continue;

    const trimmed = line.replace(/\n$/, "");

    // Unpack status
    if (trimmed.startsWith("unpack ")) {
      const status = trimmed.substring(7);
      result.unpackOk = status === "ok";
      continue;
    }

    // Ref success: "ok <refname>"
    if (trimmed.startsWith("ok ")) {
      result.refResults.push({
        refName: trimmed.substring(3),
        ok: true,
      });
      continue;
    }

    // Ref failure: "ng <refname> <reason>"
    if (trimmed.startsWith("ng ")) {
      const rest = trimmed.substring(3);
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx !== -1) {
        result.refResults.push({
          refName: rest.substring(0, spaceIdx),
          ok: false,
          reason: rest.substring(spaceIdx + 1),
        });
      } else {
        result.refResults.push({
          refName: rest,
          ok: false,
          reason: "unknown error",
        });
      }
      continue;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Request body construction
// ---------------------------------------------------------------------------

/**
 * Select capabilities to request from the server.
 *
 * Only requests capabilities that the server actually advertises.
 *
 * @param serverCapabilities - Capabilities advertised by the server
 * @returns Capabilities to include in the first ref update line
 */
function selectPushCapabilities(serverCapabilities: string[]): string[] {
  const caps: string[] = [];
  for (const cap of WANTED_CAPABILITIES) {
    if (serverCapabilities.includes(cap)) {
      caps.push(cap);
    }
  }
  return caps;
}

/**
 * Build the request body for a git-receive-pack POST.
 *
 * The body is a concatenation of:
 *   1. pkt-line encoded ref update lines (first line includes capabilities)
 *   2. Flush packet ("0000")
 *   3. Packfile binary data
 *
 * @param refUpdates - Ref updates to send
 * @param packfile - Packfile bytes from createPackfile()
 * @param serverCapabilities - Capabilities advertised by the server
 * @returns Complete request body as Uint8Array
 */
export function buildReceivePackRequest(
  refUpdates: RefUpdate[],
  packfile: Uint8Array,
  serverCapabilities: string[],
): Uint8Array {
  const caps = selectPushCapabilities(serverCapabilities);

  // Build the pkt-line text portion
  let pktText = "";

  for (let i = 0; i < refUpdates.length; i++) {
    const update = refUpdates[i];
    let line = `${update.oldHash} ${update.newHash} ${update.refName}`;

    // First line includes capabilities after \0
    if (i === 0 && caps.length > 0) {
      line += "\0" + caps.join(" ");
    }

    line += "\n";
    pktText += pktLineEncode(line);
  }

  // Flush packet to end the ref update section
  pktText += pktLineFlush();

  // Convert text portion to bytes and concatenate with packfile
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(pktText);

  const body = new Uint8Array(textBytes.length + packfile.length);
  body.set(textBytes);
  body.set(packfile, textBytes.length);

  return body;
}

// ---------------------------------------------------------------------------
// HTTP operations
// ---------------------------------------------------------------------------

/**
 * Discover refs from a git server's receive-pack endpoint.
 *
 * Sends a GET request to `<repoUrl>/info/refs?service=git-receive-pack`
 * and parses the pkt-line response into refs and capabilities.
 *
 * @param repoUrl - Base URL of the git repo (e.g. "https://grasp.example.com/npub1.../repo.git")
 * @param signal - AbortSignal for cancellation
 * @returns Parsed refs and capabilities
 * @throws On HTTP errors (401/403 = authorization, 404 = repo not found)
 */
export async function getReceivePackRefs(
  repoUrl: string,
  signal?: AbortSignal,
): Promise<InfoRefsReceivePackResponse> {
  const url = `${repoUrl}/info/refs?service=git-receive-pack`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/x-git-receive-pack-advertisement",
    },
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authorization failed (HTTP ${response.status}) for ${repoUrl}. ` +
          "For Grasp servers, ensure the repo state event (kind:30618) is in purgatory.",
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Repository not found (HTTP 404) at ${repoUrl}. ` +
          "Check that the repository URL is correct.",
      );
    }
    throw new Error(
      `HTTP ${response.status} from ${url}: ${response.statusText}`,
    );
  }

  const text = await response.text();
  const result = parseInfoRefsResponse(text);

  // Sanity check: an empty response likely means the server returned a
  // non-git response (e.g. HTML error page)
  if (
    result.capabilities.length === 0 &&
    Object.keys(result.refs).length === 0
  ) {
    throw new Error(
      `No git data returned from ${url}. ` +
        "The server may not support git-receive-pack or returned a non-git response.",
    );
  }

  return result;
}

/**
 * Push objects to a git server using the smart HTTP send-pack protocol.
 *
 * Sends ref updates and a packfile to the server's git-receive-pack endpoint.
 * If the server supports report-status, the response is parsed for per-ref
 * success/failure information.
 *
 * @param repoUrl - Base URL of the git repo
 * @param refUpdates - Ref updates to send
 * @param packfile - Packfile bytes from createPackfile() (pass empty Uint8Array if no objects needed, e.g. for delete-only)
 * @param signal - AbortSignal for cancellation
 * @returns Push result with unpack status and per-ref results
 * @throws On HTTP errors (401/403 = authorization, 404 = repo not found)
 */
export async function pushToGitServer(
  repoUrl: string,
  refUpdates: RefUpdate[],
  packfile: Uint8Array,
  signal?: AbortSignal,
): Promise<PushResult> {
  if (refUpdates.length === 0) {
    return {
      unpackOk: true,
      refResults: [],
      rawResponse: "",
    };
  }

  // First discover server capabilities
  const infoRefs = await getReceivePackRefs(repoUrl, signal);

  // Build the request body
  const body = buildReceivePackRequest(
    refUpdates,
    packfile,
    infoRefs.capabilities,
  );

  // POST to git-receive-pack
  const url = `${repoUrl}/git-receive-pack`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-git-receive-pack-request",
      Accept: "application/x-git-receive-pack-result",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: body as any,
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authorization failed (HTTP ${response.status}) for push to ${repoUrl}. ` +
          "For Grasp servers, ensure the repo state event (kind:30618) is in purgatory.",
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Repository not found (HTTP 404) at ${repoUrl}. ` +
          "Check that the repository URL is correct.",
      );
    }
    throw new Error(
      `HTTP ${response.status} from ${url}: ${response.statusText}`,
    );
  }

  const responseText = await response.text();

  // If the server supports report-status, parse the response
  if (infoRefs.capabilities.includes("report-status")) {
    return parseReportStatus(responseText);
  }

  // No report-status: assume success if HTTP was 200
  return {
    unpackOk: true,
    refResults: refUpdates.map((u) => ({
      refName: u.refName,
      ok: true,
    })),
    rawResponse: responseText,
  };
}
