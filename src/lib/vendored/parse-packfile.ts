/**
 * Vendored from @fiatjaf/git-natural-api/parse-packfile.ts
 *
 * The package doesn't export this module via its "exports" map, so we vendor
 * it here to use in tests and (later) in the push pipeline.
 *
 * TODO: Once the full git workflow (apply patches -> pack -> push) is complete,
 * review what can be PR'd back to @fiatjaf/git-natural-api and what should
 * live in our own git-grasp-pool helper package.
 */

import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Inflate } from "fflate";

/** Interface for retrieving objects by their hash */
export interface ObjectGetterByHash {
  get(hash: string): ParsedObject | undefined;
}

/** Git object type constants */
export enum ObjectType {
  COMMIT = 1,
  TREE = 2,
  BLOB = 3,
  TAG = 4,
  OFS_DELTA = 6,
  REF_DELTA = 7,
}

/** Represents a parsed Git object */
export type ParsedObject = {
  type: number; // Object type (1=commit, 2=tree, 3=blob, 4=tag)
  size: number; // Object size in bytes
  data: Uint8Array; // Raw object data
  offset: number; // Offset in packfile
  hash: string; // SHA-1 hash
};

/** Result of parsing a Git packfile */
export type PackfileResult = {
  version: number; // Packfile version
  count: number; // Number of objects
  objects: Map<string, ParsedObject>; // Map of hash to parsed objects
};

/**
 * Parses a Git packfile and extracts all objects.
 * @param data Raw packfile data bytes
 * @returns PackfileResult containing parsed objects and metadata
 */
export function parsePackfile(data: Uint8Array): PackfileResult {
  let pos = 0;

  // parse header
  const header = String.fromCharCode(...data.slice(0, 4));
  if (header !== "PACK") {
    throw new Error(
      `invalid packfile header: ${String.fromCharCode(...data.slice(0, 4))}`,
    );
  }
  pos = 4;

  const version = readUint32(data, pos);
  pos += 4;
  if (version !== 2) {
    throw new Error(`unsupported packfile version: ${version}`);
  }

  const count = readUint32(data, pos);
  pos += 4;

  const objects = new Map<string, ParsedObject>();

  // parse all objects
  for (let i = 0; i < count; i++) {
    const [obj, newPos] = parseObject(data, pos, objects);
    objects.set(obj.hash, obj);
    pos = newPos;
  }

  return { objects, version, count };
}

function parseObject(
  data: Uint8Array,
  startPos: number,
  objects: ObjectGetterByHash,
): [ParsedObject, number] {
  let pos = startPos;
  const offset = startPos;

  // read type and size
  let byte = data[pos++];
  let type = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;

  while (byte & 0x80) {
    byte = data[pos++];
    size |= (byte & 0x7f) << shift;
    shift += 7;
  }

  let objData: Uint8Array;
  if (type === ObjectType.OFS_DELTA) {
    const [fullObject, newPos, actualType] = parseOfsDelta(
      data,
      pos,
      size,
      offset,
      objects,
    );
    objData = fullObject;
    pos = newPos;
    type = actualType;
  } else if (type === ObjectType.REF_DELTA) {
    const [fullObject, newPos, actualType] = parseRefDelta(
      data,
      pos,
      size,
      objects,
    );
    objData = fullObject;
    pos = newPos;
    type = actualType;
  } else if (
    type === ObjectType.COMMIT ||
    type === ObjectType.TREE ||
    type === ObjectType.BLOB ||
    type === ObjectType.TAG
  ) {
    const [decompressed, newPos] = decompress(data, pos, size);
    objData = decompressed;
    pos = newPos;
  } else {
    throw new Error(`unknown object type: ${type}`);
  }

  return [
    {
      type,
      size,
      data: objData,
      offset,
      hash: computeObjectHash(type, objData),
    },
    pos,
  ];
}

function parseOfsDelta(
  data: Uint8Array,
  pos: number,
  size: number,
  currentOffset: number,
  objects: ObjectGetterByHash,
): [fullObj: Uint8Array, newPos: number, actualType: number] {
  // read offset
  let byte = data[pos++];
  let offset = byte & 0x7f;

  while (byte & 0x80) {
    offset += 1;
    offset <<= 7;
    byte = data[pos++];
    offset += byte & 0x7f;
  }

  const baseOffset = currentOffset - offset;
  const [baseObject, _] = parseObject(data, baseOffset, objects);

  if (!baseObject) {
    throw new Error(`base object not found at offset ${baseOffset}`);
  }

  // decompress delta
  const [delta, newPos] = decompress(data, pos, size);

  // apply delta
  const fullObj = applyDelta(delta, baseObject.data);

  return [fullObj, newPos, baseObject.type];
}

function parseRefDelta(
  data: Uint8Array,
  pos: number,
  size: number,
  objects: ObjectGetterByHash,
): [fullObj: Uint8Array, newPos: number, actualType: number] {
  // read name
  const baseName = bytesToHex(data.subarray(pos, pos + 20));
  pos += 20;

  // decompress delta
  const [delta, newPos] = decompress(data, pos, size);

  const baseObject = objects.get(baseName);
  if (!baseObject) {
    throw new Error(`base object not found with name ${baseName}`);
  }

  // apply delta
  const fullObj = applyDelta(delta, baseObject.data);

  return [fullObj, newPos, baseObject.type];
}

function computeObjectHash(type: number, data: Uint8Array): string {
  const typeStr =
    type === ObjectType.COMMIT
      ? "commit"
      : type === ObjectType.TREE
        ? "tree"
        : type === ObjectType.BLOB
          ? "blob"
          : type === ObjectType.TAG
            ? "tag"
            : "";

  if (!typeStr) throw new Error("no type when computing object hash");

  const header = `${typeStr} ${data.length}\0`;
  const headerBytes = new TextEncoder().encode(header);
  const combined = new Uint8Array(headerBytes.length + data.length);
  combined.set(headerBytes);
  combined.set(data, headerBytes.length);

  return bytesToHex(sha1(combined));
}

function applyDelta(delta: Uint8Array, base: Uint8Array): Uint8Array {
  let pos = 0;

  // read base size
  const [_baseSize, bytesRead1] = readVariableInt(delta, pos);
  pos += bytesRead1;

  // read result size
  const [resultSize, bytesRead2] = readVariableInt(delta, pos);
  pos += bytesRead2;

  const result = new Uint8Array(resultSize);
  let resultOffset = 0;

  while (pos < delta.length) {
    const cmd = delta[pos++];

    if (cmd & 0x80) {
      // copy command
      let offset = 0;
      let copySize = 0;

      if (cmd & 0x01) offset = delta[pos++];
      if (cmd & 0x02) offset |= delta[pos++] << 8;
      if (cmd & 0x04) offset |= delta[pos++] << 16;
      if (cmd & 0x08) offset |= delta[pos++] << 24;

      if (cmd & 0x10) copySize = delta[pos++];
      if (cmd & 0x20) copySize |= delta[pos++] << 8;
      if (cmd & 0x40) copySize |= delta[pos++] << 16;

      if (copySize === 0) copySize = 0x10000;

      // copy from base
      result.set(base.subarray(offset, offset + copySize), resultOffset);
      resultOffset += copySize;
    } else if (cmd > 0) {
      // insert command
      result.set(delta.subarray(pos, pos + cmd), resultOffset);
      pos += cmd;
      resultOffset += cmd;
    } else {
      throw new Error("invalid delta command");
    }
  }

  return new Uint8Array(result);
}

function readVariableInt(data: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  let byte: number;

  do {
    byte = data[pos++];
    bytesRead++;
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);

  return [value, bytesRead];
}

function readUint32(data: Uint8Array, pos: number): number {
  return (
    (data[pos] << 24) |
    (data[pos + 1] << 16) |
    (data[pos + 2] << 8) |
    data[pos + 3]
  );
}

// Taken from fflate's internals to strip the zlib header from a zlib payload.
function zlibPrefix(d: Uint8Array): number {
  return ((d[1] >> 3) & 4) + 2;
}

function decompress(
  data: Uint8Array,
  currentPos: number,
  decompressedSize: number,
): [decompressedData: Uint8Array, newPos: number] {
  try {
    return inflate(data, currentPos, decompressedSize, [0.25, 0.2, 0.15, 0.1]);
  } catch (err) {
    if (err instanceof BigBatchError) {
      return inflate(
        data,
        currentPos,
        decompressedSize,
        err.goodBatch ? [err.goodBatch] : [],
      );
    }
    throw err;
  }
}

class BigBatchError extends Error {
  goodBatch: number;

  constructor(goodBatch: number) {
    super("we tried to decompress too much data at the same time");
    this.goodBatch = goodBatch;
  }
}

function inflate(
  data: Uint8Array,
  currentPos: number,
  decompressedSize: number,
  batches: number[],
): [decompressedData: Uint8Array, newPos: number] {
  let decompressedSoFar = 0;
  let done = false;
  const decompressed = new Uint8Array(decompressedSize);
  const inflater = new Inflate((chunk) => {
    if (chunk.length) {
      decompressed.set(chunk, decompressedSoFar);
      decompressedSoFar += chunk.length;
      if (decompressedSoFar === decompressedSize) {
        done = true;
      }
    }
  });

  let pos = currentPos;
  pos += zlibPrefix(data.subarray(pos));

  for (let b = 0; b < batches.length; b++) {
    const batchSize = Math.round(decompressedSize * batches[b]);
    inflater.push(data.subarray(pos, pos + batchSize));
    pos += batchSize;

    if (done) {
      const goodBatch = batches.slice(0, b).reduce((acc, v) => acc + v, 0);
      throw new BigBatchError(goodBatch);
    }
  }

  if (!done) {
    for (; pos < data.length; pos += 4) {
      if (done) break;
      inflater.push(data.subarray(pos, pos + 4));
    }
  }

  // Check adler32 checksum — scan forward until it matches
  let i: number;
  for (i = 0; i < 24; i++) {
    if (adler32(decompressed) === readUint32(data, pos - 4)) break;
    pos++;
  }
  if (i == 24) {
    throw new Error("checksum never validated");
  }

  return [decompressed, pos];
}

function adler32(data: Uint8Array): number {
  const MOD_ADLER = 65521;

  let a = 1;
  let b = 0;

  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }

  const checksum = (b << 16) | a;

  return checksum;
}
