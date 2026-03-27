import { describe, it, expect } from "vitest";
import {
  pktLineEncode,
  pktLineFlush,
  parsePktLines,
  stripSideBand,
  parseInfoRefsResponse,
  parseReportStatus,
  buildReceivePackRequest,
  ZERO_HASH,
  type RefUpdate,
} from "@/lib/git-push";

// ---------------------------------------------------------------------------
// 1. pkt-line encoding
// ---------------------------------------------------------------------------

describe("pktLineEncode", () => {
  it("encodes a simple string with correct length prefix", () => {
    // "hello\n" is 6 chars, + 4 for prefix = 10 = 0x000a
    const result = pktLineEncode("hello\n");
    expect(result).toBe("000ahello\n");
  });

  it("encodes a longer string correctly", () => {
    // "want abc123\n" is 12 chars, + 4 = 16 = 0x0010
    const result = pktLineEncode("want abc123\n");
    expect(result).toBe("0010want abc123\n");
  });

  it("returns flush packet for empty string", () => {
    expect(pktLineEncode("")).toBe("0000");
  });

  it("encodes a ref update line correctly", () => {
    const oldHash = "0000000000000000000000000000000000000000";
    const newHash = "abc1234567890abcdef1234567890abcdef12345";
    const line = `${oldHash} ${newHash} refs/heads/main\n`;
    const encoded = pktLineEncode(line);

    // line is 40 + 1 + 40 + 1 + 15 + 1 = 98 chars, + 4 = 102 = 0x0066
    const expectedLen = (line.length + 4).toString(16).padStart(4, "0");
    expect(encoded).toBe(expectedLen + line);
    expect(encoded.substring(0, 4)).toBe("0066");
  });

  it("encodes a line with capabilities correctly", () => {
    const line =
      `${ZERO_HASH} abc1234567890abcdef1234567890abcdef12345 refs/heads/main` +
      "\0report-status delete-refs\n";
    const encoded = pktLineEncode(line);
    const len = parseInt(encoded.substring(0, 4), 16);
    expect(len).toBe(line.length + 4);
    expect(encoded.substring(4)).toBe(line);
  });
});

describe("pktLineFlush", () => {
  it("returns 0000", () => {
    expect(pktLineFlush()).toBe("0000");
  });
});

// ---------------------------------------------------------------------------
// 2. pkt-line parsing
// ---------------------------------------------------------------------------

describe("parsePktLines", () => {
  it("parses a simple sequence of pkt-lines", () => {
    const input =
      pktLineEncode("line one\n") +
      pktLineEncode("line two\n") +
      pktLineFlush();

    const lines = parsePktLines(input);
    expect(lines).toEqual(["line one\n", "line two\n", ""]);
  });

  it("parses flush-only input", () => {
    const lines = parsePktLines("0000");
    expect(lines).toEqual([""]);
  });

  it("parses multiple flush packets", () => {
    const input = pktLineFlush() + pktLineFlush();
    const lines = parsePktLines(input);
    expect(lines).toEqual(["", ""]);
  });

  it("handles empty input", () => {
    const lines = parsePktLines("");
    expect(lines).toEqual([]);
  });

  it("parses a sample info/refs receive-pack response", () => {
    // Simulate a typical info/refs response
    const serviceAnnounce = pktLineEncode("# service=git-receive-pack\n");
    const flush = pktLineFlush();
    const firstRef = pktLineEncode(
      "abc1234567890abcdef1234567890abcdef12345 refs/heads/main\0report-status delete-refs ofs-delta\n",
    );
    const secondRef = pktLineEncode(
      "def5678901234567890abcdef1234567890abcdef refs/heads/dev\n",
    );
    const endFlush = pktLineFlush();

    const input = serviceAnnounce + flush + firstRef + secondRef + endFlush;
    const lines = parsePktLines(input);

    expect(lines.length).toBe(5);
    expect(lines[0]).toContain("# service=git-receive-pack");
    expect(lines[1]).toBe(""); // flush
    expect(lines[2]).toContain("refs/heads/main");
    expect(lines[2]).toContain("\0report-status");
    expect(lines[3]).toContain("refs/heads/dev");
    expect(lines[4]).toBe(""); // flush
  });

  it("parses a report-status response", () => {
    const input =
      pktLineEncode("unpack ok\n") +
      pktLineEncode("ok refs/heads/main\n") +
      pktLineFlush();

    const lines = parsePktLines(input);
    expect(lines).toEqual(["unpack ok\n", "ok refs/heads/main\n", ""]);
  });
});

// ---------------------------------------------------------------------------
// 3. Side-band-64k handling
// ---------------------------------------------------------------------------

describe("stripSideBand", () => {
  it("strips channel 1 prefix from lines", () => {
    const lines = ["\x01unpack ok\n", "\x01ok refs/heads/main\n", ""];
    const result = stripSideBand(lines);
    expect(result).toEqual(["unpack ok\n", "ok refs/heads/main\n", ""]);
  });

  it("ignores channel 2 (progress) lines", () => {
    const lines = [
      "\x01unpack ok\n",
      "\x02Processing objects: 100%\n",
      "\x01ok refs/heads/main\n",
      "",
    ];
    const result = stripSideBand(lines);
    expect(result).toEqual(["unpack ok\n", "ok refs/heads/main\n", ""]);
  });

  it("throws on channel 3 (error) lines", () => {
    const lines = ["\x03fatal: repository not found\n"];
    expect(() => stripSideBand(lines)).toThrow("git server error");
    expect(() => stripSideBand(lines)).toThrow("repository not found");
  });

  it("passes through lines without side-band prefix", () => {
    const lines = ["unpack ok\n", "ok refs/heads/main\n", ""];
    const result = stripSideBand(lines);
    expect(result).toEqual(["unpack ok\n", "ok refs/heads/main\n", ""]);
  });

  it("handles empty input", () => {
    expect(stripSideBand([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. parseInfoRefsResponse
// ---------------------------------------------------------------------------

describe("parseInfoRefsResponse", () => {
  it("parses a standard receive-pack info/refs response", () => {
    // Build a realistic response as the server would send it
    const lines = [
      pktLineEncode("# service=git-receive-pack\n"),
      pktLineFlush(),
      pktLineEncode(
        "abc1234567890abcdef1234567890abcdef12345 refs/heads/main\0report-status delete-refs ofs-delta\n",
      ),
      pktLineEncode(
        "def5678901234567890abcdef1234567890abcdef refs/heads/dev\n",
      ),
      pktLineFlush(),
    ].join("");

    const result = parseInfoRefsResponse(lines);

    expect(result.refs).toEqual({
      "refs/heads/main": "abc1234567890abcdef1234567890abcdef12345",
      "refs/heads/dev": "def5678901234567890abcdef1234567890abcdef",
    });
    expect(result.capabilities).toContain("report-status");
    expect(result.capabilities).toContain("delete-refs");
    expect(result.capabilities).toContain("ofs-delta");
  });

  it("parses a response with a single ref", () => {
    const lines = [
      pktLineEncode("# service=git-receive-pack\n"),
      pktLineFlush(),
      pktLineEncode(
        "abc1234567890abcdef1234567890abcdef12345 refs/heads/main\0report-status\n",
      ),
      pktLineFlush(),
    ].join("");

    const result = parseInfoRefsResponse(lines);

    expect(Object.keys(result.refs)).toHaveLength(1);
    expect(result.refs["refs/heads/main"]).toBe(
      "abc1234567890abcdef1234567890abcdef12345",
    );
    expect(result.capabilities).toEqual(["report-status"]);
  });

  it("parses a response with no refs (empty repo)", () => {
    // An empty repo may advertise capabilities on a zero-hash line
    const lines = [
      pktLineEncode("# service=git-receive-pack\n"),
      pktLineFlush(),
      pktLineEncode(
        `${ZERO_HASH} capabilities^{}\0report-status delete-refs\n`,
      ),
      pktLineFlush(),
    ].join("");

    const result = parseInfoRefsResponse(lines);

    // The "capabilities^{}" is a pseudo-ref for empty repos
    expect(result.refs["capabilities^{}"]).toBe(ZERO_HASH);
    expect(result.capabilities).toContain("report-status");
    expect(result.capabilities).toContain("delete-refs");
  });

  it("handles multiple refs including tags", () => {
    const lines = [
      pktLineEncode("# service=git-receive-pack\n"),
      pktLineFlush(),
      pktLineEncode(
        "aaaa234567890abcdef1234567890abcdef12345 refs/heads/main\0report-status\n",
      ),
      pktLineEncode(
        "bbbb234567890abcdef1234567890abcdef12345 refs/heads/feature\n",
      ),
      pktLineEncode(
        "cccc234567890abcdef1234567890abcdef12345 refs/tags/v1.0\n",
      ),
      pktLineFlush(),
    ].join("");

    const result = parseInfoRefsResponse(lines);

    expect(Object.keys(result.refs)).toHaveLength(3);
    expect(result.refs["refs/heads/main"]).toBe(
      "aaaa234567890abcdef1234567890abcdef12345",
    );
    expect(result.refs["refs/heads/feature"]).toBe(
      "bbbb234567890abcdef1234567890abcdef12345",
    );
    expect(result.refs["refs/tags/v1.0"]).toBe(
      "cccc234567890abcdef1234567890abcdef12345",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. parseReportStatus
// ---------------------------------------------------------------------------

describe("parseReportStatus", () => {
  it("parses a successful response", () => {
    const input =
      pktLineEncode("unpack ok\n") +
      pktLineEncode("ok refs/heads/main\n") +
      pktLineFlush();

    const result = parseReportStatus(input);

    expect(result.unpackOk).toBe(true);
    expect(result.refResults).toEqual([
      { refName: "refs/heads/main", ok: true },
    ]);
  });

  it("parses a failed unpack response", () => {
    const input =
      pktLineEncode("unpack error - bad pack header\n") + pktLineFlush();

    const result = parseReportStatus(input);

    expect(result.unpackOk).toBe(false);
    expect(result.refResults).toEqual([]);
  });

  it("parses mixed ref results", () => {
    const input =
      pktLineEncode("unpack ok\n") +
      pktLineEncode("ok refs/heads/main\n") +
      pktLineEncode("ng refs/heads/protected non-fast-forward\n") +
      pktLineEncode("ok refs/heads/feature\n") +
      pktLineFlush();

    const result = parseReportStatus(input);

    expect(result.unpackOk).toBe(true);
    expect(result.refResults).toHaveLength(3);
    expect(result.refResults[0]).toEqual({
      refName: "refs/heads/main",
      ok: true,
    });
    expect(result.refResults[1]).toEqual({
      refName: "refs/heads/protected",
      ok: false,
      reason: "non-fast-forward",
    });
    expect(result.refResults[2]).toEqual({
      refName: "refs/heads/feature",
      ok: true,
    });
  });

  it("parses side-band-64k wrapped response", () => {
    // Side-band-64k: each pkt-line payload starts with \x01 for data channel
    const input =
      pktLineEncode("\x01unpack ok\n") +
      pktLineEncode("\x01ok refs/heads/main\n") +
      pktLineEncode("\x02Resolving deltas: 100%\n") + // progress (channel 2)
      pktLineFlush();

    const result = parseReportStatus(input);

    expect(result.unpackOk).toBe(true);
    expect(result.refResults).toEqual([
      { refName: "refs/heads/main", ok: true },
    ]);
  });

  it("parses response with multiple ok refs", () => {
    const input =
      pktLineEncode("unpack ok\n") +
      pktLineEncode("ok refs/heads/main\n") +
      pktLineEncode("ok refs/heads/dev\n") +
      pktLineEncode("ok refs/nostr/abc123\n") +
      pktLineFlush();

    const result = parseReportStatus(input);

    expect(result.unpackOk).toBe(true);
    expect(result.refResults).toHaveLength(3);
    expect(result.refResults.every((r) => r.ok)).toBe(true);
    expect(result.refResults.map((r) => r.refName)).toEqual([
      "refs/heads/main",
      "refs/heads/dev",
      "refs/nostr/abc123",
    ]);
  });

  it("parses ng ref with multi-word reason", () => {
    const input =
      pktLineEncode("unpack ok\n") +
      pktLineEncode(
        "ng refs/heads/main hook declined push: branch is locked\n",
      ) +
      pktLineFlush();

    const result = parseReportStatus(input);

    expect(result.unpackOk).toBe(true);
    expect(result.refResults).toHaveLength(1);
    expect(result.refResults[0]).toEqual({
      refName: "refs/heads/main",
      ok: false,
      reason: "hook declined push: branch is locked",
    });
  });

  it("preserves raw response text", () => {
    const input =
      pktLineEncode("unpack ok\n") +
      pktLineEncode("ok refs/heads/main\n") +
      pktLineFlush();

    const result = parseReportStatus(input);
    expect(result.rawResponse).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 6. buildReceivePackRequest
// ---------------------------------------------------------------------------

describe("buildReceivePackRequest", () => {
  const decoder = new TextDecoder();

  it("builds a request with a single ref update and capabilities", () => {
    const refUpdates: RefUpdate[] = [
      {
        oldHash: ZERO_HASH,
        newHash: "abc1234567890abcdef1234567890abcdef12345",
        refName: "refs/heads/main",
      },
    ];
    const packfile = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
    const serverCaps = ["report-status", "delete-refs", "ofs-delta"];

    const body = buildReceivePackRequest(refUpdates, packfile, serverCaps);

    // Decode the text portion (everything before the packfile)
    const text = decoder.decode(body);

    // Should contain the ref update line with capabilities
    expect(text).toContain(ZERO_HASH);
    expect(text).toContain("abc1234567890abcdef1234567890abcdef12345");
    expect(text).toContain("refs/heads/main");
    expect(text).toContain("\0report-status delete-refs");
    // Should NOT contain ofs-delta (not in WANTED_CAPABILITIES)
    expect(text).not.toContain("ofs-delta");

    // Should end with flush + packfile
    // The last 4 bytes of the text portion should be the packfile "PACK"
    expect(body[body.length - 4]).toBe(0x50); // P
    expect(body[body.length - 3]).toBe(0x41); // A
    expect(body[body.length - 2]).toBe(0x43); // C
    expect(body[body.length - 1]).toBe(0x4b); // K
  });

  it("builds a request with multiple ref updates", () => {
    const refUpdates: RefUpdate[] = [
      {
        oldHash: "1111111111111111111111111111111111111111",
        newHash: "2222222222222222222222222222222222222222",
        refName: "refs/heads/main",
      },
      {
        oldHash: ZERO_HASH,
        newHash: "3333333333333333333333333333333333333333",
        refName: "refs/heads/feature",
      },
    ];
    const packfile = new Uint8Array([]);
    const serverCaps = ["report-status"];

    const body = buildReceivePackRequest(refUpdates, packfile, serverCaps);
    const text = decoder.decode(body);

    // First line should have capabilities
    expect(text).toContain("refs/heads/main\0report-status\n");
    // Second line should NOT have capabilities
    expect(text).toContain("refs/heads/feature\n");
    // Verify the second line doesn't have \0
    const featureLineStart = text.indexOf(
      "3333333333333333333333333333333333333333",
    );
    const featureLineEnd = text.indexOf("\n", featureLineStart);
    const featureLine = text.substring(featureLineStart - 41, featureLineEnd);
    expect(featureLine).not.toContain("\0");
  });

  it("builds a request with no matching capabilities", () => {
    const refUpdates: RefUpdate[] = [
      {
        oldHash: ZERO_HASH,
        newHash: "abc1234567890abcdef1234567890abcdef12345",
        refName: "refs/heads/main",
      },
    ];
    const packfile = new Uint8Array([]);
    // Server doesn't support any of our wanted capabilities
    const serverCaps = ["ofs-delta", "shallow"];

    const body = buildReceivePackRequest(refUpdates, packfile, serverCaps);
    const text = decoder.decode(body);

    // Should NOT contain \0 since no capabilities to send
    expect(text).not.toContain("\0");
    expect(text).toContain("refs/heads/main\n");
  });

  it("includes flush packet between ref updates and packfile", () => {
    const refUpdates: RefUpdate[] = [
      {
        oldHash: ZERO_HASH,
        newHash: "abc1234567890abcdef1234567890abcdef12345",
        refName: "refs/heads/main",
      },
    ];
    const packfile = new Uint8Array([0xff, 0xfe]);
    const serverCaps: string[] = [];

    const body = buildReceivePackRequest(refUpdates, packfile, serverCaps);
    const text = decoder.decode(body.slice(0, body.length - 2));

    // Should end with flush packet "0000"
    expect(text).toMatch(/0000$/);

    // Packfile bytes should be at the end
    expect(body[body.length - 2]).toBe(0xff);
    expect(body[body.length - 1]).toBe(0xfe);
  });

  it("builds a delete ref request with zero new hash", () => {
    const refUpdates: RefUpdate[] = [
      {
        oldHash: "abc1234567890abcdef1234567890abcdef12345",
        newHash: ZERO_HASH,
        refName: "refs/heads/old-branch",
      },
    ];
    const packfile = new Uint8Array([]);
    const serverCaps = ["report-status", "delete-refs"];

    const body = buildReceivePackRequest(refUpdates, packfile, serverCaps);
    const text = decoder.decode(body);

    expect(text).toContain("abc1234567890abcdef1234567890abcdef12345");
    expect(text).toContain(ZERO_HASH);
    expect(text).toContain("refs/heads/old-branch");
    expect(text).toContain("delete-refs");
  });

  it("produces valid pkt-line format for each ref update line", () => {
    const refUpdates: RefUpdate[] = [
      {
        oldHash: ZERO_HASH,
        newHash: "abc1234567890abcdef1234567890abcdef12345",
        refName: "refs/heads/main",
      },
    ];
    const packfile = new Uint8Array([]);
    const serverCaps = ["report-status"];

    const body = buildReceivePackRequest(refUpdates, packfile, serverCaps);
    const text = decoder.decode(body);

    // Parse the first pkt-line
    const lenHex = text.substring(0, 4);
    const len = parseInt(lenHex, 16);
    expect(len).toBeGreaterThan(4);

    // The payload should be exactly len - 4 characters
    const payload = text.substring(4, len);
    expect(payload.length).toBe(len - 4);
    expect(payload).toContain(ZERO_HASH);
    expect(payload).toContain("refs/heads/main");
    expect(payload).toContain("\0report-status");
    expect(payload).toMatch(/\n$/);
  });
});

// ---------------------------------------------------------------------------
// 7. ZERO_HASH constant
// ---------------------------------------------------------------------------

describe("ZERO_HASH", () => {
  it("is 40 zero characters", () => {
    expect(ZERO_HASH).toBe("0000000000000000000000000000000000000000");
    expect(ZERO_HASH.length).toBe(40);
  });
});
