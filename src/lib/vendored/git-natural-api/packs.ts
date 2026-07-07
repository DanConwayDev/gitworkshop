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
 *  - fetchPackfile: parses upload-pack responses as pkt-lines so shallow
 *    response flush packets before NAK/ACK negotiation do not hide the pack.
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

function decodeAscii(data: Uint8Array): string {
  return String.fromCharCode(...data);
}

function readPktLen(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) {
    throw new Error("truncated pkt-line length");
  }

  const len = parseInt(decodeAscii(data.subarray(offset, offset + 4)), 16);
  if (Number.isNaN(len)) {
    throw new Error(`invalid pkt-line length at offset ${offset}`);
  }

  return len;
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

  let offset = 0;
  while (offset < data.length) {
    const len = readPktLen(data, offset);
    if (len === 0) {
      offset += 4;
      continue;
    }

    if (len < 4 || offset + len > data.length) {
      throw new Error(`invalid pkt-line at offset ${offset}`);
    }

    const payloadStart = offset + 4;
    const payload = data.subarray(payloadStart, offset + len);

    // Side-band channels mark the beginning of the packfile stream. Leave
    // offset at the packet header so the packfile loop below can consume it.
    if (payload[0] === 1 || payload[0] === 2 || payload[0] === 3) {
      break;
    }

    const line = decodeAscii(payload);
    if (line.startsWith("ERR upload-pack: not our ref")) {
      throw new MissingRef();
    }
    if (line.startsWith("ERR ")) {
      throw new Error(line.trim());
    }

    // Negotiation/status pkt-lines (shallow/unshallow/ACK/NAK) precede the
    // side-band pack stream. Continue until the first side-band packet.
    offset += len;
  }

  const packfileData: number[] = [];
  while (offset < data.length) {
    const len = readPktLen(data, offset);
    if (len === 0) break;

    if (len < 5 || offset + len > data.length) {
      throw new Error(`invalid side-band pkt-line at offset ${offset}`);
    }

    if (data[offset + 4] === 2) {
      // just a message, ignore
    } else if (data[offset + 4] === 1) {
      packfileData.push(...data.subarray(offset + 4 + 1, offset + len));
    } else if (data[offset + 4] === 3) {
      throw new Error(
        decodeAscii(data.subarray(offset + 4 + 1, offset + len)).trim(),
      );
    }
    offset += len;
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
