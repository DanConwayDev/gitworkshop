/**
 * Vendored from @fiatjaf/git-natural-api v0.2.4
 * https://jsr.io/@fiatjaf/git-natural-api
 *
 * Local modifications (already applied):
 *  - fetchPackfile: read the response body via `arrayBuffer()` instead of the
 *    newer `Response.prototype.bytes()` (Chrome 121+/Firefox 133+/Safari 18.2+)
 *    so packfile fetches work on older Chromium builds.
 *  - fetchPackfile: accepts an AbortSignal so stalled upload-pack requests can
 *    be cancelled by callers instead of leaving UI flows waiting forever.
 */

import { type PackfileResult, parsePackfile } from "./parse-packfile.ts";

export const necessaryCapabilities = ["multi_ack_detailed", "side-band-64k"];

export const requiredCapabilities = ["shallow", "object-format=sha1"];

export const defaultCapabilities = ["ofs-delta", "no-progress"];

export class MissingRef extends Error {
  constructor() {
    super("missing ref");
  }
}

export class InvalidCommit extends Error {
  constructor(commit: string) {
    super(`invalid commit '${commit}', must be 20 byte hex`);
  }
}

/**
 * Low-level function to fetch a Git packfile from a remote server and parse it.
 * @param url Base URL of the Git repository
 * @param want Pkt-line encoded want request body
 * @returns Promise resolving to parsed packfile data
 */
export async function fetchPackfile(
  url: string,
  want: string,
  signal?: AbortSignal,
): Promise<PackfileResult> {
  const resp = await fetch(`${url}/git-upload-pack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-git-upload-pack-request",
      Accept: "application/x-git-upload-pack-result",
    },
    body: want,
    signal,
  });

  if (resp.status !== 200) {
    throw new Error(`failed to call git-upload-pack: ${await resp.text()}`);
  }

  // NOTE: use arrayBuffer() rather than Response.prototype.bytes(). The latter
  // only shipped in Chrome 121 / Firefox 133 / Safari 18.2, so on older
  // Chromium builds `resp.bytes` is undefined and every packfile fetch throws
  // `resp.bytes is not a function`. Because info/refs is parsed via .text()
  // (universally supported), the symptom was the git-server-status dropdown
  // showing every server green while the file explorer reported "missing
  // objects" for every server — only on older Chrome. arrayBuffer() has been
  // supported for years across all browsers.
  const data = new Uint8Array(await resp.arrayBuffer());

  if (data.length === 0) {
    throw new Error("empty response");
  }

  let prev = 0;
  let offset = 0;
  while (offset < data.length) {
    prev = offset;
    const idx = data.subarray(prev + 1).indexOf(10);
    if (idx === -1) {
      if (
        String.fromCharCode(...data.subarray(4, 32)) ===
        "ERR upload-pack: not our ref"
      ) {
        throw new MissingRef();
      }

      throw new Error(
        `unexpected '${String.fromCharCode(...data.subarray(0, 63))}'`,
      );
    }
    offset = prev + idx + 1;
    const line = String.fromCharCode(...data.subarray(prev + 4, offset));
    if (line.startsWith("NAK") || line.startsWith("ACK")) {
      break;
    }
  }
  offset++;

  const packfileData: number[] = [];
  while (offset < data.length) {
    const len = parseInt(
      String.fromCharCode(...data.subarray(offset, offset + 4)),
      16,
    );
    if (data[offset + 4] === 2) {
      // just a message, ignore
    } else if (data[offset + 4] === 1) {
      packfileData.push(...data.subarray(offset + 4 + 1, offset + len));
    }
    offset += len;

    if (len === 0) break;
  }

  return parsePackfile(new Uint8Array(packfileData));
}

function pktEncode(data: string): string {
  if (data.length === 0) {
    return "0000"; // flush-pkt
  }

  // length includes the 4-byte header itself
  const len = data.length + 4;
  const hexLen = len.toString(16).padStart(4, "0");

  return hexLen + data;
}

export function createWantRequest(
  commitSha: string,
  capabilities: string[],
  deepen: number | undefined,
  filter?: string,
  haves: string[] = [],
): string {
  if (commitSha.length !== 40) throw new InvalidCommit(commitSha);

  const pkts: string[] = [];

  pkts.push(`want ${commitSha} ${capabilities.join(" ")} agent=nsa/1.0.0\n`);
  if (typeof deepen !== "undefined") {
    pkts.push(`deepen ${deepen}\n`);
  }
  if (filter) {
    pkts.push("filter " + filter + "\n");
  }
  pkts.push("");

  for (const have of haves) {
    if (have.length !== 40) throw new InvalidCommit(have);
    pkts.push(`have ${have}\n`);
  }
  pkts.push("done\n");

  return pkts.map(pktEncode).join("");
}
