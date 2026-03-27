/**
 * Shared Grasp utilities.
 */

interface Nip11Document {
  supported_grasps?: string[];
  [key: string]: unknown;
}

/**
 * Fetch the NIP-11 relay information document for a domain and verify it
 * advertises at least GRASP-01 support.
 *
 * Returns `null` on success, or an error string to display to the user.
 */
export async function validateGraspServer(
  domain: string,
): Promise<string | null> {
  const url = `https://${domain}`;
  let doc: Nip11Document;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return `Server returned HTTP ${res.status} — is it a Nostr relay?`;
    }

    doc = (await res.json()) as Nip11Document;
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return "Server did not respond in time";
    }
    return "Could not reach server — check the domain and try again";
  }

  const grasps = doc.supported_grasps;
  if (!Array.isArray(grasps) || !grasps.includes("GRASP-01")) {
    return "Server does not advertise Grasp support (missing GRASP-01 in NIP-11)";
  }

  return null;
}
