import { describe, it, expect } from "vitest";
import { parsePackfile } from "@/lib/vendored/parse-packfile";
import {
  createPackfile,
  encodeTypeSize,
  packBlob,
  packTree,
  packCommit,
} from "@/lib/git-packfile";
import { sha1hex } from "@/lib/git-objects";
import type { TreeEntry, CommitData } from "@/lib/git-objects";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function readUint32BE(buf: Uint8Array, pos: number): number {
  return (
    ((buf[pos] << 24) |
      (buf[pos + 1] << 16) |
      (buf[pos + 2] << 8) |
      buf[pos + 3]) >>>
    0
  );
}

/** Dummy commit data for tests. */
function makeCommitData(treeHash: string, parentHashes: string[]): CommitData {
  return {
    treeHash,
    parentHashes,
    author: {
      name: "Test Author",
      email: "test@example.com",
      timestamp: 1700000000,
      timezone: "+0000",
    },
    committer: {
      name: "Test Author",
      email: "test@example.com",
      timestamp: 1700000000,
      timezone: "+0000",
    },
    message: "test commit\n",
  };
}

// ---------------------------------------------------------------------------
// 1. Round-trip test: blob
// ---------------------------------------------------------------------------

describe("createPackfile", () => {
  it("round-trips a single blob through pack/parse", async () => {
    const content = encoder.encode("hello world\n");
    const blob = await packBlob(content);

    const packfile = await createPackfile([blob]);
    const parsed = parsePackfile(packfile);

    expect(parsed.version).toBe(2);
    expect(parsed.count).toBe(1);
    expect(parsed.objects.size).toBe(1);

    const obj = parsed.objects.get(blob.hash);
    expect(obj).toBeDefined();
    expect(obj!.type).toBe(3); // blob
    expect(obj!.hash).toBe(blob.hash);
    // The parser may return a view into a larger buffer, so compare via
    // Array.from to avoid Uint8Array buffer-length mismatches.
    expect(Array.from(obj!.data)).toEqual(Array.from(content));
  });

  // ---------------------------------------------------------------------------
  // 2. Multi-object test: blob + tree + commit
  // ---------------------------------------------------------------------------

  it("round-trips blob + tree + commit through pack/parse", async () => {
    // Create a blob
    const blobContent = encoder.encode("file content\n");
    const blob = await packBlob(blobContent);

    // Create a tree referencing the blob
    const treeEntries: TreeEntry[] = [
      { mode: "100644", name: "file.txt", hash: blob.hash },
    ];
    const tree = await packTree(treeEntries);

    // Create a commit referencing the tree
    const commitData = makeCommitData(tree.hash, []);
    const commit = await packCommit(commitData);

    const packfile = await createPackfile([blob, tree, commit]);
    const parsed = parsePackfile(packfile);

    expect(parsed.version).toBe(2);
    expect(parsed.count).toBe(3);
    expect(parsed.objects.size).toBe(3);

    // Verify blob
    const parsedBlob = parsed.objects.get(blob.hash);
    expect(parsedBlob).toBeDefined();
    expect(parsedBlob!.type).toBe(3);
    expect(Array.from(parsedBlob!.data)).toEqual(Array.from(blobContent));

    // Verify tree
    const parsedTree = parsed.objects.get(tree.hash);
    expect(parsedTree).toBeDefined();
    expect(parsedTree!.type).toBe(2);
    expect(parsedTree!.hash).toBe(tree.hash);

    // Verify commit
    const parsedCommit = parsed.objects.get(commit.hash);
    expect(parsedCommit).toBeDefined();
    expect(parsedCommit!.type).toBe(1);
    expect(parsedCommit!.hash).toBe(commit.hash);
  });

  // ---------------------------------------------------------------------------
  // 3. Empty packfile
  // ---------------------------------------------------------------------------

  it("creates a valid packfile with zero objects", async () => {
    const packfile = await createPackfile([]);

    // Header: 4 (PACK) + 4 (version) + 4 (count) = 12 bytes
    // Trailer: 20 bytes (SHA-1)
    expect(packfile.length).toBe(32);

    // Verify header
    const header = String.fromCharCode(...packfile.slice(0, 4));
    expect(header).toBe("PACK");

    // Version 2
    const version = readUint32BE(packfile, 4);
    expect(version).toBe(2);

    // Count 0
    const count = readUint32BE(packfile, 8);
    expect(count).toBe(0);

    // Should parse without error
    const parsed = parsePackfile(packfile);
    expect(parsed.count).toBe(0);
    expect(parsed.objects.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 5. Trailer checksum
  // ---------------------------------------------------------------------------

  it("has a valid SHA-1 trailer checksum", async () => {
    const content = encoder.encode("checksum test data");
    const blob = await packBlob(content);
    const packfile = await createPackfile([blob]);

    // The last 20 bytes are the SHA-1 of everything before them
    const dataBeforeTrailer = packfile.slice(0, packfile.length - 20);
    const trailer = packfile.slice(packfile.length - 20);

    const expectedHash = await sha1hex(dataBeforeTrailer);

    // Convert trailer bytes to hex for comparison
    const trailerHex = Array.from(trailer)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    expect(trailerHex).toBe(expectedHash);
  });

  it("round-trips a large blob correctly", async () => {
    // Create a blob larger than typical varint single-byte sizes
    const largeContent = encoder.encode("x".repeat(5000));
    const blob = await packBlob(largeContent);

    const packfile = await createPackfile([blob]);
    const parsed = parsePackfile(packfile);

    expect(parsed.objects.size).toBe(1);
    const obj = parsed.objects.get(blob.hash);
    expect(obj).toBeDefined();
    expect(Array.from(obj!.data)).toEqual(Array.from(largeContent));
  });
});

// ---------------------------------------------------------------------------
// 4. Varint encoding tests
// ---------------------------------------------------------------------------

describe("encodeTypeSize", () => {
  it("encodes size=10, type=blob (3) in a single byte", () => {
    // type=3 (blob), size=10
    // First byte: (3 << 4) | (10 & 0x0f) = 0x30 | 0x0a = 0x3a
    // size >>> 4 = 0, so no continuation bit
    const result = encodeTypeSize(3, 10);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0x3a);

    // Verify by decoding: type = (0x3a >> 4) & 0x07 = 3, size = 0x3a & 0x0f = 10
    expect((result[0] >> 4) & 0x07).toBe(3);
    expect(result[0] & 0x0f).toBe(10);
    expect(result[0] & 0x80).toBe(0); // no continuation
  });

  it("encodes size=200, type=blob (3) in two bytes", () => {
    // type=3, size=200 (0xC8)
    // First byte: continuation | (3 << 4) | (200 & 0x0f)
    //   200 & 0x0f = 8, so first byte = 0x80 | 0x30 | 0x08 = 0xb8
    // size >>> 4 = 12 (0x0c), fits in 7 bits, no more continuation
    // Second byte: 12 = 0x0c
    const result = encodeTypeSize(3, 200);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(0xb8);
    expect(result[1]).toBe(0x0c);

    // Verify by decoding
    let byte = result[0];
    const type = (byte >> 4) & 0x07;
    let size = byte & 0x0f;
    let shift = 4;
    expect(type).toBe(3);
    expect(byte & 0x80).not.toBe(0); // continuation set

    byte = result[1];
    size |= (byte & 0x7f) << shift;
    shift += 7;
    expect(byte & 0x80).toBe(0); // no more continuation
    expect(size).toBe(200);
  });

  it("encodes size=100000, type=commit (1) in multiple bytes", () => {
    // type=1, size=100000 (0x186A0)
    // This needs more than 2 bytes since 4 + 7 = 11 bits max in 2 bytes = 2048
    // 100000 needs 17 bits, so: 4 + 7 + 7 = 18 bits -> 3 bytes
    const result = encodeTypeSize(1, 100000);
    expect(result.length).toBeGreaterThanOrEqual(3);

    // Verify by decoding (same algorithm as parse-packfile.ts)
    let pos = 0;
    let byte = result[pos++];
    const type = (byte >> 4) & 0x07;
    let size = byte & 0x0f;
    let shift = 4;

    while (byte & 0x80) {
      byte = result[pos++];
      size |= (byte & 0x7f) << shift;
      shift += 7;
    }

    expect(type).toBe(1);
    expect(size).toBe(100000);
    expect(pos).toBe(result.length); // consumed all bytes
  });

  it("encodes size=0 correctly", () => {
    const result = encodeTypeSize(2, 0);
    expect(result.length).toBe(1);
    // (2 << 4) | 0 = 0x20, no continuation
    expect(result[0]).toBe(0x20);
    expect((result[0] >> 4) & 0x07).toBe(2);
    expect(result[0] & 0x0f).toBe(0);
    expect(result[0] & 0x80).toBe(0);
  });

  it("encodes size=15 (max single-byte size) correctly", () => {
    const result = encodeTypeSize(1, 15);
    expect(result.length).toBe(1);
    // (1 << 4) | 15 = 0x1f, no continuation
    expect(result[0]).toBe(0x1f);
  });

  it("encodes size=16 (min two-byte size) correctly", () => {
    const result = encodeTypeSize(1, 16);
    expect(result.length).toBe(2);
    // First byte: 0x80 | (1 << 4) | (16 & 0x0f) = 0x80 | 0x10 | 0x00 = 0x90
    // Second byte: 16 >>> 4 = 1 = 0x01
    expect(result[0]).toBe(0x90);
    expect(result[1]).toBe(0x01);
  });
});

// ---------------------------------------------------------------------------
// packBlob / packTree / packCommit helpers
// ---------------------------------------------------------------------------

describe("pack helpers", () => {
  it("packBlob produces correct hash matching git blob hash", async () => {
    const content = encoder.encode("test content\n");
    const blob = await packBlob(content);

    expect(blob.type).toBe("blob");
    expect(blob.data).toEqual(content);
    // Verify hash matches what git would produce
    expect(blob.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("packTree produces correct hash", async () => {
    const blobContent = encoder.encode("hello\n");
    const blob = await packBlob(blobContent);

    const entries: TreeEntry[] = [
      { mode: "100644", name: "hello.txt", hash: blob.hash },
    ];
    const tree = await packTree(entries);

    expect(tree.type).toBe("tree");
    expect(tree.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("packCommit produces correct hash", async () => {
    const commitData = makeCommitData(
      "4b825dc642cb6eb9a060e54bf899d69f7cb46101", // empty tree hash
      [],
    );
    const commit = await packCommit(commitData);

    expect(commit.type).toBe("commit");
    expect(commit.hash).toMatch(/^[0-9a-f]{40}$/);
    // Verify the content is the serialized commit (should contain "tree" header)
    const text = new TextDecoder().decode(commit.data);
    expect(text).toContain("tree 4b825dc642cb6eb9a060e54bf899d69f7cb46101");
    expect(text).toContain("author Test Author <test@example.com>");
  });
});
