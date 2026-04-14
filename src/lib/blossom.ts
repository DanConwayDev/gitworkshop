/**
 * Blossom upload utilities.
 *
 * Implements a subset of the Blossom protocol (BUD-01, BUD-02, BUD-04):
 *   - Upload to multiple servers simultaneously (Promise.any — fastest wins)
 *   - Mirror the blob to all remaining servers in the background (BUD-04)
 *   - Per-server 30-second timeout via AbortSignal
 *   - Returns NIP-94 tags (url, x, ox, size, m) for imeta injection
 *   - Appends file extension to content-addressed URLs if missing
 *   - Computes image dimensions and blurhash for NIP-94 imeta tags
 *
 * Intentionally has no external dependencies beyond the Web Crypto API and
 * the browser's native fetch — avoids pulling in @nostrify/nostrify which
 * requires zod v4 (incompatible with our zod v3).
 */

import type { EventTemplate } from "nostr-tools";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A NIP-07-compatible signer (subset we actually need). */
export interface BlossomSigner {
  signEvent(
    template: EventTemplate,
  ): Promise<{ id: string; sig: string; pubkey: string } & EventTemplate>;
  getPublicKey(): Promise<string>;
}

/** NIP-94 tag tuple: ["url" | "x" | "ox" | "size" | "m" | "dim" | "blurhash", value] */
export type Nip94Tags = [["url", string], ...string[][]];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a Uint8Array as a lowercase hex string (no external dep). */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Encode a string as base64 (browser-native). */
function toBase64(str: string): string {
  return btoa(str);
}

/** Compute SHA-256 of a File and return the hex digest. */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return toHex(new Uint8Array(digest));
}

/** Extract the file extension (with leading dot) from a filename, or "" if none. */
export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return "";
  return filename.slice(dot).toLowerCase();
}

/** Append a file extension to a URL if its path doesn't already have one. */
export function appendExtensionIfMissing(
  urlString: string,
  ext: string,
): string {
  if (!ext) return urlString;
  try {
    const url = new URL(urlString);
    const lastSegment = url.pathname.split("/").pop() ?? "";
    if (lastSegment.includes(".")) return urlString;
    url.pathname = url.pathname + ext;
    return url.toString();
  } catch {
    return urlString;
  }
}

// ---------------------------------------------------------------------------
// Image resizing
// ---------------------------------------------------------------------------

/** Maximum dimension (width or height) for uploaded images. */
const MAX_IMAGE_DIMENSION = 1920;

/** JPEG quality for resized images (0–1). */
const JPEG_QUALITY = 0.85;

/**
 * Resize an image file so its longest side is at most MAX_IMAGE_DIMENSION
 * pixels, encoding as whichever of JPEG/PNG is smaller.
 *
 * If the image already fits within the limit, the original file is returned
 * unchanged. Non-image files are returned as-is.
 */
export async function resizeImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // Unsupported format — skip resize
  }

  const { width, height } = bitmap;

  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    bitmap.close();
    return file;
  }

  const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file; // Canvas unavailable — skip resize
  }

  ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
  bitmap.close();

  // Encode as both JPEG and PNG, pick the smaller one
  const [jpegBlob, pngBlob] = await Promise.all([
    canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY),
    canvasToBlob(canvas, "image/png"),
  ]);

  const best =
    jpegBlob.size <= pngBlob.size
      ? { blob: jpegBlob, ext: ".jpg", mime: "image/jpeg" as const }
      : { blob: pngBlob, ext: ".png", mime: "image/png" as const };

  return new File([best.blob], replaceExtension(file.name, best.ext), {
    type: best.mime,
  });
}

/** Promisified canvas.toBlob. */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Failed to encode ${type}`))),
      type,
      quality,
    );
  });
}

/** Replace or append a file extension. */
function replaceExtension(filename: string, ext: string): string {
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return base + ext;
}

// ---------------------------------------------------------------------------
// Image metadata (dimensions + blurhash)
// ---------------------------------------------------------------------------

/**
 * For an image File, returns `{ dim: "WxH", blurhash: "..." }`.
 * Decodes to a small canvas (max 64 px wide) for speed.
 * Returns an empty object for non-image files or if anything fails.
 */
export async function getImageMeta(
  file: File,
): Promise<{ dim?: string; blurhash?: string }> {
  if (!file.type.startsWith("image/")) return {};
  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objectUrl;
      });

      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      if (!naturalWidth || !naturalHeight) return {};

      const dim = `${naturalWidth}x${naturalHeight}`;

      // Downsample for blurhash — 64 px wide is fast enough
      const SAMPLE_W = 64;
      const scale = SAMPLE_W / naturalWidth;
      const sampleW = SAMPLE_W;
      const sampleH = Math.max(1, Math.round(naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = sampleW;
      canvas.height = sampleH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { dim };

      ctx.drawImage(img, 0, 0, sampleW, sampleH);
      const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

      // Lazy-load blurhash encoder to keep the main bundle lean
      const { encode } = await import("blurhash");
      const blurhash = encode(data, sampleW, sampleH, 4, 3);
      return { dim, blurhash };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Blossom descriptor schema (manual parse — no zod v4 needed)
// ---------------------------------------------------------------------------

interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type?: string;
}

function parseBlobDescriptor(json: unknown): BlobDescriptor {
  if (typeof json !== "object" || json === null) {
    throw new Error("Blossom: response is not an object");
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.url !== "string") throw new Error("Blossom: missing url");
  if (typeof obj.sha256 !== "string")
    throw new Error("Blossom: missing sha256");
  if (typeof obj.size !== "number") throw new Error("Blossom: missing size");
  return {
    url: obj.url,
    sha256: obj.sha256,
    size: obj.size,
    type: typeof obj.type === "string" ? obj.type : undefined,
  };
}

// ---------------------------------------------------------------------------
// Core upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to one or more Blossom servers.
 *
 * Uses `Promise.any` so the first successful server wins. Each server gets a
 * 30-second timeout. Returns NIP-94 tags including dim + blurhash for images.
 */
export async function blossomUpload(
  file: File,
  servers: string[],
  signer: BlossomSigner,
): Promise<Nip94Tags> {
  if (servers.length === 0) {
    throw new Error("No Blossom servers configured");
  }

  // Resize images larger than 1920px before uploading
  file = await resizeImage(file);

  const x = await sha256Hex(file);
  const now = Date.now();
  const expiration = now + 60_000;

  const event = await signer.signEvent({
    kind: 24242,
    content: `Upload ${file.name}`,
    created_at: Math.floor(now / 1000),
    tags: [
      ["t", "upload"],
      ["x", x],
      ["size", file.size.toString()],
      ["expiration", Math.floor(expiration / 1000).toString()],
    ],
  });

  // Encode auth header: base64(JSON.stringify(event))
  const authorization = `Nostr ${toBase64(JSON.stringify(event))}`;

  const tags = await Promise.any(
    servers.map(async (server) => {
      const url = new URL("/upload", server);
      const signal = AbortSignal.timeout(30_000);

      const response = await fetch(url, {
        method: "PUT",
        body: file,
        headers: {
          authorization,
          "content-type": file.type,
        },
        signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Blossom upload failed (${response.status}): ${text}`);
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Blossom server returned non-JSON response: ${text}`);
      }

      const data = parseBlobDescriptor(json);

      const result: Nip94Tags = [
        ["url", data.url],
        ["x", data.sha256],
        ["ox", data.sha256],
        ["size", data.size.toString()],
      ];

      if (data.type) result.push(["m", data.type]);

      return result;
    }),
  );

  // Fix up the URL: append extension if the content-addressed path lacks one
  const ext = getFileExtension(file.name);
  if (ext) {
    tags[0][1] = appendExtensionIfMissing(tags[0][1], ext);
    // Keep the url tag in sync if it was also stored separately
    const urlTag = tags.find((t) => t[0] === "url");
    if (urlTag) urlTag[1] = tags[0][1];
  }

  // Compute image metadata (dim + blurhash) and append to tags
  const { dim, blurhash } = await getImageMeta(file);
  if (dim) tags.push(["dim", dim]);
  if (blurhash) tags.push(["blurhash", blurhash]);

  // Mirror to remaining servers in the background (BUD-04, fire-and-forget)
  const uploadedUrl = tags[0][1];
  const uploadedServer = servers.find((s) => uploadedUrl.startsWith(s));
  const mirrorServers = servers.filter((s) => s !== uploadedServer);
  if (mirrorServers.length > 0) {
    blossomMirror(uploadedUrl, x, mirrorServers, signer).catch(() => {
      // Mirroring is best-effort — never fail the upload if it fails
    });
  }

  return tags;
}

// ---------------------------------------------------------------------------
// BUD-04 mirroring
// ---------------------------------------------------------------------------

/** Mirror a blob to additional Blossom servers (BUD-04). Fire-and-forget. */
async function blossomMirror(
  sourceUrl: string,
  sha256: string,
  servers: string[],
  signer: BlossomSigner,
): Promise<void> {
  const now = Date.now();

  // BUD-11: PUT /mirror requires t="upload" and x=<sha256> tags
  const event = await signer.signEvent({
    kind: 24242,
    content: "Mirror blob",
    created_at: Math.floor(now / 1000),
    tags: [
      ["t", "upload"],
      ["x", sha256],
      ["expiration", Math.floor((now + 60_000) / 1000).toString()],
    ],
  });

  const authorization = `Nostr ${toBase64(JSON.stringify(event))}`;

  await Promise.allSettled(
    servers.map((server) =>
      fetch(new URL("/mirror", server), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: JSON.stringify({ url: sourceUrl }),
        signal: AbortSignal.timeout(30_000),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Default fallback servers
// ---------------------------------------------------------------------------

export const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.ditto.pub",
  "https://blossom.dreamith.to",
  "https://blossom.primal.net",
];
