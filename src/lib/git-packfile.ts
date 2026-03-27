/**
 * git-packfile — construct git packfile v2 binary data from raw git objects.
 *
 * Git packfiles are the binary format used by the smart HTTP push protocol to
 * transfer objects between client and server. This module creates packfiles
 * containing full (non-delta) objects — no OFS_DELTA or REF_DELTA encoding.
 *
 * Packfile v2 format:
 *   1. Header: "PACK" (4 bytes) + version 2 (4 bytes BE) + object count (4 bytes BE)
 *   2. For each object: type+size varint header + zlib-deflated object data
 *   3. Trailer: SHA-1 checksum of everything before it (20 bytes)
 *
 * The packfiles produced by this module are compatible with real git servers
 * (GitHub, Gitea, cgit, etc.) and with the parsePackfile function from
 * @fiatjaf/git-natural-api.
 *
 * Uses:
 *   - fflate's deflateSync for zlib compression (matching the parse side's Inflate)
 *   - crypto.subtle.digest("SHA-1", ...) for the trailer checksum (consistent
 *     with git-objects.ts)
 *   - Serialization helpers from git-objects.ts for building PackableObjects
 */

import { deflateSync } from "fflate";
import {
  sha1hex,
  gitObjectBytes,
  serializeTreeContent,
  serializeCommitContent,
  type TreeEntry,
  type CommitData,
} from "@/lib/git-objects";

// ---------------------------------------------------------------------------
// Object type constants (matching parse-packfile.ts ObjectType enum)
// ---------------------------------------------------------------------------

/** Git packfile object type numbers. */
const OBJECT_TYPE = {
  commit: 1,
  tree: 2,
  blob: 3,
} as const;

// ---------------------------------------------------------------------------
// PackableObject interface
// ---------------------------------------------------------------------------

/** A git object ready to be packed into a packfile. */
export interface PackableObject {
  /** Object type: "blob" | "tree" | "commit" */
  type: "blob" | "tree" | "commit";
  /** The raw object content (WITHOUT the `type size\0` header — just the content portion). */
  data: Uint8Array;
  /** The 40-char hex SHA-1 hash of the full git object (with header). */
  hash: string;
}

// ---------------------------------------------------------------------------
// Varint encoding
// ---------------------------------------------------------------------------

/**
 * Encode a packfile object type+size header as a varint byte sequence.
 *
 * The encoding is the inverse of the parser in parse-packfile.ts:
 *   - First byte: bits 6-4 = object type (3 bits), bits 3-0 = low 4 bits of
 *     size, bit 7 = continuation flag
 *   - Subsequent bytes: bits 6-0 = next 7 bits of size, bit 7 = continuation
 *
 * @param type - Packfile object type number (1=commit, 2=tree, 3=blob)
 * @param size - Uncompressed object size in bytes
 * @returns The encoded varint bytes
 */
export function encodeTypeSize(type: number, size: number): Uint8Array {
  const bytes: number[] = [];

  // First byte: type in bits 6-4, low 4 bits of size in bits 3-0
  let firstByte = ((type & 0x07) << 4) | (size & 0x0f);
  size >>>= 4;

  if (size > 0) {
    // More bytes follow — set continuation bit
    firstByte |= 0x80;
  }
  bytes.push(firstByte);

  // Subsequent bytes: 7 bits of size each
  while (size > 0) {
    let nextByte = size & 0x7f;
    size >>>= 7;
    if (size > 0) {
      nextByte |= 0x80; // continuation bit
    }
    bytes.push(nextByte);
  }

  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Packfile construction
// ---------------------------------------------------------------------------

/**
 * Write a 32-bit unsigned integer in big-endian format.
 */
function writeUint32BE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (value >>> 24) & 0xff;
  buf[1] = (value >>> 16) & 0xff;
  buf[2] = (value >>> 8) & 0xff;
  buf[3] = value & 0xff;
  return buf;
}

/**
 * Create a git packfile v2 containing the given objects.
 *
 * Returns the complete packfile bytes: header + compressed objects + SHA-1
 * trailer. All objects are stored as full objects (no delta encoding).
 *
 * The trailer is the raw 20-byte SHA-1 of everything before it (header +
 * all object entries), computed with crypto.subtle.digest("SHA-1", ...).
 *
 * @param objects - The git objects to pack
 * @returns Complete packfile bytes
 */
export async function createPackfile(
  objects: PackableObject[],
): Promise<Uint8Array> {
  // --- Build header ---
  // "PACK" magic bytes
  const magic = new TextEncoder().encode("PACK");
  // Version 2
  const version = writeUint32BE(2);
  // Object count
  const count = writeUint32BE(objects.length);

  // --- Encode each object ---
  const encodedObjects: Uint8Array[] = [];
  for (const obj of objects) {
    const typeNum = OBJECT_TYPE[obj.type];

    // Type+size varint header (size is the UNCOMPRESSED size)
    const header = encodeTypeSize(typeNum, obj.data.length);

    // Zlib-deflate the raw object data.
    // deflateSync produces raw DEFLATE; we need zlib wrapping for git.
    // fflate's zlibSync would add the zlib header, but git packfiles use
    // zlib-wrapped data. Let's use zlibSync instead.
    const compressed = zlibCompress(obj.data);

    encodedObjects.push(header);
    encodedObjects.push(compressed);
  }

  // --- Concatenate header + objects ---
  const totalBeforeTrailer =
    magic.length +
    version.length +
    count.length +
    encodedObjects.reduce((sum, arr) => sum + arr.length, 0);

  const packData = new Uint8Array(totalBeforeTrailer);
  let offset = 0;

  packData.set(magic, offset);
  offset += magic.length;
  packData.set(version, offset);
  offset += version.length;
  packData.set(count, offset);
  offset += count.length;

  for (const chunk of encodedObjects) {
    packData.set(chunk, offset);
    offset += chunk.length;
  }

  // --- Compute SHA-1 trailer ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hashBuffer = await crypto.subtle.digest("SHA-1", packData as any);
  const trailer = new Uint8Array(hashBuffer);

  // --- Final packfile: data + trailer ---
  const result = new Uint8Array(packData.length + trailer.length);
  result.set(packData);
  result.set(trailer, packData.length);

  return result;
}

/**
 * Compress data using zlib (DEFLATE with zlib header/trailer).
 *
 * Git packfiles use zlib-wrapped compressed data. The parse side in
 * parse-packfile.ts strips the zlib prefix before inflating, so we must
 * include it.
 *
 * fflate's deflateSync produces raw DEFLATE. We manually add the zlib
 * header (2 bytes) and Adler-32 trailer (4 bytes) to match what git expects.
 */
function zlibCompress(data: Uint8Array): Uint8Array {
  // Raw DEFLATE
  const deflated = deflateSync(data);

  // Zlib header: CMF=0x78 (deflate, window size 32K), FLG=0x01
  // CMF = 0x78: CM=8 (deflate), CINFO=7 (32K window)
  // FLG: FCHECK must make (CMF*256 + FLG) % 31 == 0
  // 0x78*256 + FLG => 30720 + FLG; 30720 % 31 = 0, so FLG=0x01 => 30721 % 31 = 1
  // Actually: 30720 % 31 = 30720 / 31 = 990.96... => 31*990 = 30690, 30720-30690=30 => remainder 30
  // So FLG needs FCHECK such that (30720 + FCHECK) % 31 == 0 => FCHECK = 1
  const cmf = 0x78;
  const flg = 0x01; // (0x78 * 256 + 0x01) = 30721, 30721 % 31 = 0 ✓

  // Adler-32 checksum of the uncompressed data
  const adler = adler32(data);

  // Assemble: [CMF, FLG] + deflated + [adler32 BE]
  const result = new Uint8Array(2 + deflated.length + 4);
  result[0] = cmf;
  result[1] = flg;
  result.set(deflated, 2);

  // Adler-32 in big-endian
  result[2 + deflated.length] = (adler >>> 24) & 0xff;
  result[2 + deflated.length + 1] = (adler >>> 16) & 0xff;
  result[2 + deflated.length + 2] = (adler >>> 8) & 0xff;
  result[2 + deflated.length + 3] = adler & 0xff;

  return result;
}

/**
 * Compute the Adler-32 checksum of data.
 * Used for the zlib trailer.
 */
function adler32(data: Uint8Array): number {
  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;

  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }

  return ((b << 16) | a) >>> 0;
}

// ---------------------------------------------------------------------------
// Helper functions to build PackableObjects from git-objects.ts primitives
// ---------------------------------------------------------------------------

/**
 * Create a PackableObject for a blob.
 *
 * @param content - Raw file content bytes
 * @returns A PackableObject with the blob data and its SHA-1 hash
 */
export async function packBlob(content: Uint8Array): Promise<PackableObject> {
  const fullObject = gitObjectBytes("blob", content);
  const hash = await sha1hex(fullObject);
  return { type: "blob", data: content, hash };
}

/**
 * Create a PackableObject for a tree.
 *
 * @param entries - Tree entries (will be sorted by serializeTreeContent)
 * @returns A PackableObject with the serialized tree data and its SHA-1 hash
 */
export async function packTree(entries: TreeEntry[]): Promise<PackableObject> {
  const content = serializeTreeContent(entries);
  const fullObject = gitObjectBytes("tree", content);
  const hash = await sha1hex(fullObject);
  return { type: "tree", data: content, hash };
}

/**
 * Create a PackableObject for a commit.
 *
 * @param data - Commit data (will be serialized by serializeCommitContent)
 * @returns A PackableObject with the serialized commit data and its SHA-1 hash
 */
export async function packCommit(data: CommitData): Promise<PackableObject> {
  const content = serializeCommitContent(data);
  const fullObject = gitObjectBytes("commit", content);
  const hash = await sha1hex(fullObject);
  return { type: "commit", data: content, hash };
}
