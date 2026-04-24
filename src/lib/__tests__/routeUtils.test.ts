import { describe, it, expect } from "vitest";
import {
  parseRepoRoute,
  repoToPath,
  relayUrlToSegment,
  parseRelayUrl,
} from "@/lib/routeUtils";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEX_PUBKEY =
  "da74d4da0507527520e4f9e752d9596597c900c1264d03b5fb7ec9de31873b80";
// npub1mf6dfks9qaf82g8yl8n49k2evktujqxpyexs8d0m0myauvv88wqq54yc67 = nip19.npubEncode(HEX_PUBKEY)
const NPUB = "npub1mf6dfks9qaf82g8yl8n49k2evktujqxpyexs8d0m0myauvv88wqq54yc67";

// Real-world gnostr repo used to reproduce the %2F decode bug
const GNOSTR_NIP05 = "vortex@vortex.gnostr.cloud";
const GNOSTR_REPO_ID =
  "9edfa6a0bf147e7ea74b4f03dedfc1eddd3c4c29400ed2c9fca3e3b6499a3b45/vortex-sidecar-1776042879";

// ---------------------------------------------------------------------------
// 1. parseRepoRoute — baseline formats
// ---------------------------------------------------------------------------

describe("parseRepoRoute — baseline formats", () => {
  it("parses /:npub/:repoId", () => {
    const parsed = parseRepoRoute(`${NPUB}/my-repo`);
    expect(parsed?.type).toBe("npub");
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "npub") {
      expect(parsed.pubkey).toBe(HEX_PUBKEY);
      expect(parsed.relayHints).toEqual([]);
    }
  });

  it("parses /:npub/:relayHint/:repoId", () => {
    const parsed = parseRepoRoute(`${NPUB}/relay.damus.io/my-repo`);
    expect(parsed?.type).toBe("npub");
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "npub") {
      expect(parsed.relayHints).toEqual(["wss://relay.damus.io/"]);
    }
  });

  it("parses /:user@domain.com/:repoId as nip05", () => {
    const parsed = parseRepoRoute("user@domain.com/my-repo");
    expect(parsed?.type).toBe("nip05");
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "nip05") {
      expect(parsed.nip05).toBe("user@domain.com");
      expect(parsed.relayHints).toEqual([]);
    }
  });

  it("parses /:domain.com/:repoId as nip05 with _@ normalisation", () => {
    const parsed = parseRepoRoute("domain.com/my-repo");
    expect(parsed?.type).toBe("nip05");
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "nip05") {
      expect(parsed.nip05).toBe("_@domain.com");
    }
  });

  it("parses /:user@domain.com/:relayHint/:repoId as nip05", () => {
    const parsed = parseRepoRoute("user@domain.com/relay.damus.io/my-repo");
    expect(parsed?.type).toBe("nip05");
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "nip05") {
      expect(parsed.nip05).toBe("user@domain.com");
      expect(parsed.relayHints).toEqual(["wss://relay.damus.io/"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. parseRepoRoute — d-tag with / encoded as %2F (the gnostr bug)
// ---------------------------------------------------------------------------

describe("parseRepoRoute — d-tag with encoded slash (%2F)", () => {
  it("decodes %2F in repoId to a literal slash (npub, no relay)", () => {
    const splat = `${NPUB}/${HEX_PUBKEY}%2Fvortex-sidecar`;
    const parsed = parseRepoRoute(splat);
    expect(parsed).toBeDefined();
    expect(parsed?.repoId).toBe(`${HEX_PUBKEY}/vortex-sidecar`);
    if (parsed?.type === "npub") {
      expect(parsed.pubkey).toBe(HEX_PUBKEY);
    }
  });

  it("decodes %2F in repoId to a literal slash (nip05, no relay)", () => {
    const splat = `user@domain.com/${HEX_PUBKEY}%2Fvortex-sidecar`;
    const parsed = parseRepoRoute(splat);
    expect(parsed).toBeDefined();
    expect(parsed?.repoId).toBe(`${HEX_PUBKEY}/vortex-sidecar`);
    if (parsed?.type === "nip05") {
      expect(parsed.nip05).toBe("user@domain.com");
    }
  });

  it("handles relay hint + encoded slash: 3 literal segments, relay not swallowed by repoId", () => {
    // splat has 3 literal /-separated segments: NPUB / relay.damus.io / HEX%2Fvortex-sidecar
    // The relay hint must not be consumed as part of the repoId.
    const splat = `${NPUB}/relay.damus.io/${HEX_PUBKEY}%2Fvortex-sidecar`;
    const parsed = parseRepoRoute(splat);
    expect(parsed).toBeDefined();
    expect(parsed?.repoId).toBe(`${HEX_PUBKEY}/vortex-sidecar`);
    if (parsed?.type === "npub") {
      expect(parsed.relayHints).toEqual(["wss://relay.damus.io/"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. parseRepoRoute — other special characters in d-tags
// ---------------------------------------------------------------------------

describe("parseRepoRoute — special characters in d-tags", () => {
  it("decodes %20 (space) in repoId", () => {
    expect(parseRepoRoute(`${NPUB}/my%20repo`)?.repoId).toBe("my repo");
  });

  it("decodes %40 (at-sign) in repoId", () => {
    expect(parseRepoRoute(`${NPUB}/my%40repo`)?.repoId).toBe("my@repo");
  });

  it("decodes %3A (colon) in repoId", () => {
    expect(parseRepoRoute(`${NPUB}/my%3Arepo`)?.repoId).toBe("my:repo");
  });

  it("decodes percent-encoded emoji in repoId (%F0%9F%8E%B8 = 🎸)", () => {
    expect(parseRepoRoute(`${NPUB}/my%F0%9F%8E%B8repo`)?.repoId).toBe(
      "my\u{1F3B8}repo",
    );
  });

  it("accepts a literal emoji in the repoId segment (no encoding)", () => {
    // When the emoji is already in the string verbatim, decodeURIComponent is a no-op
    expect(parseRepoRoute(`${NPUB}/my\u{1F3B8}repo`)?.repoId).toBe(
      "my\u{1F3B8}repo",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. parseRepoRoute — sub-paths are stripped before parsing
// ---------------------------------------------------------------------------

describe("parseRepoRoute — sub-path stripping", () => {
  it.each([
    [`${NPUB}/my-repo/issues`, "my-repo"],
    [`${NPUB}/relay.damus.io/my-repo/issues`, "my-repo"],
    [`${NPUB}/${HEX_PUBKEY}%2Fmy-repo/issues`, `${HEX_PUBKEY}/my-repo`],
    [`${NPUB}/my-repo/prs/nevent1abc123`, "my-repo"],
    [`${NPUB}/my-repo/tree/main/src/foo.ts`, "my-repo"],
  ])("strips sub-path from '%s' → repoId '%s'", (splat, expectedRepoId) => {
    const parsed = parseRepoRoute(splat);
    expect(parsed).toBeDefined();
    expect(parsed?.repoId).toBe(expectedRepoId);
  });
});

// ---------------------------------------------------------------------------
// 5. parseRepoRoute — relay hints with special encoding
// ---------------------------------------------------------------------------

describe("parseRepoRoute — relay hints with special encoding", () => {
  it("parses bare domain relay hint (relay.damus.io)", () => {
    const parsed = parseRepoRoute(`${NPUB}/relay.damus.io/my-repo`);
    expect(parsed?.type).toBe("npub");
    if (parsed?.type === "npub") {
      expect(parsed.relayHints).toEqual(["wss://relay.damus.io/"]);
    }
  });

  it("parses relay.damus.io%3A443 — port encoded as %3A", () => {
    const parsed = parseRepoRoute(`${NPUB}/relay.damus.io%3A443/my-repo`);
    expect(parsed).toBeDefined();
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "npub") {
      // Port 443 is the wss:// default; URL normalisation may strip it.
      // We only assert that a relay hint is present and uses wss://.
      expect(parsed.relayHints).toHaveLength(1);
      expect(parsed.relayHints[0]).toMatch(/^wss:\/\/relay\.damus\.io/);
    }
  });

  it("parses ws%3A%2F%2Frelay.example.com — fully encoded ws:// URL", () => {
    const parsed = parseRepoRoute(
      `${NPUB}/ws%3A%2F%2Frelay.example.com/my-repo`,
    );
    expect(parsed).toBeDefined();
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "npub") {
      expect(parsed.relayHints).toEqual(["ws://relay.example.com/"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. parseRepoRoute — returns undefined for invalid inputs
// ---------------------------------------------------------------------------

describe("parseRepoRoute — invalid inputs return undefined", () => {
  it("returns undefined for empty string", () => {
    expect(parseRepoRoute("")).toBeUndefined();
  });

  it("returns undefined for a single segment (npub only, no repoId)", () => {
    expect(parseRepoRoute(NPUB)).toBeUndefined();
  });

  it("returns undefined for 4+ unrecognised segments", () => {
    // Three literal /-separated segments after stripping (none are sub-paths)
    expect(
      parseRepoRoute(`${NPUB}/relay.damus.io/extra/my-repo`),
    ).toBeUndefined();
  });

  it("accepts a raw hex pubkey as the first segment", () => {
    const parsed = parseRepoRoute(`${HEX_PUBKEY}/my-repo`);
    expect(parsed).toBeDefined();
    expect(parsed?.type).toBe("npub");
    if (parsed?.type === "npub") {
      expect(parsed.pubkey).toBe(HEX_PUBKEY);
    }
    expect(parsed?.repoId).toBe("my-repo");
  });

  it("returns undefined for a bare path with no identity segment", () => {
    expect(parseRepoRoute("my-repo")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. parseRepoRoute — pre-decoded slash (React Router %2F bug)
//
// React Router's useParams() calls decodeURIComponent on the splat before
// returning it, so %2F becomes a literal / by the time parseRepoRoute sees it.
// The function must not mistake the first half of a slash-containing d-tag for
// a relay hint.
//
// These tests document BROKEN behaviour and are expected to fail until the
// code is fixed.
// ---------------------------------------------------------------------------

describe("parseRepoRoute — pre-decoded slash in repoId (React Router decode bug)", () => {
  it("real-world case: gnostr nip05 repo with hex/name d-tag (decoded %2F)", () => {
    // URL was: vortex@vortex.gnostr.cloud/9edfa6a0...%2Fvortex-sidecar-1776042879
    // React Router decoded %2F → /, so splat has 3 literal segments.
    // Bug: 9edfa6a0... is mistaken for a relay hint; repoId becomes only "vortex-sidecar-1776042879"
    const splat = `${GNOSTR_NIP05}/${GNOSTR_REPO_ID}`;
    const parsed = parseRepoRoute(splat);
    expect(parsed).toBeDefined();
    expect(parsed?.repoId).toBe(GNOSTR_REPO_ID);
    if (parsed?.type === "nip05") {
      expect(parsed.relayHints).toEqual([]);
      expect(parsed.nip05).toBe(GNOSTR_NIP05);
    }
  });

  it("nip05: hex64/name d-tag — hex64 must not be treated as relay hint", () => {
    const splat = `user@domain.com/${HEX_PUBKEY}/vortex-sidecar`;
    const parsed = parseRepoRoute(splat);
    expect(parsed?.repoId).toBe(`${HEX_PUBKEY}/vortex-sidecar`);
    if (parsed?.type === "nip05") {
      expect(parsed.relayHints).toEqual([]);
    }
  });

  it("npub: hex64/name d-tag — hex64 must not be treated as relay hint", () => {
    const splat = `${NPUB}/${HEX_PUBKEY}/vortex-sidecar`;
    const parsed = parseRepoRoute(splat);
    expect(parsed?.repoId).toBe(`${HEX_PUBKEY}/vortex-sidecar`);
    if (parsed?.type === "npub") {
      expect(parsed.relayHints).toEqual([]);
    }
  });

  it("nip05: hex64/name d-tag with sub-path stripped (issues)", () => {
    // After React Router decode: 4 segments — sub-path stripping must not
    // swallow part of the repo id.
    const splat = `user@domain.com/${HEX_PUBKEY}/vortex-sidecar/issues`;
    const parsed = parseRepoRoute(splat);
    expect(parsed?.repoId).toBe(`${HEX_PUBKEY}/vortex-sidecar`);
  });
});

// ---------------------------------------------------------------------------
// 8. Round-trip: repoToPath → parseRepoRoute
// ---------------------------------------------------------------------------

describe("round-trip: repoToPath → parseRepoRoute", () => {
  /** Build a path then parse the splat back out. */
  function roundTrip(
    pubkey: string,
    repoId: string,
    relays: string[],
    nip05?: string,
  ) {
    const path = repoToPath(pubkey, repoId, relays, nip05);
    // Strip the leading "/" to get the splat that the router passes in
    const splat = path.slice(1);
    return { path, splat, parsed: parseRepoRoute(splat) };
  }

  it("round-trips a standard repo (no relay, no nip05)", () => {
    const { parsed } = roundTrip(HEX_PUBKEY, "my-repo", []);
    expect(parsed?.repoId).toBe("my-repo");
    if (parsed?.type === "npub") {
      expect(parsed.pubkey).toBe(HEX_PUBKEY);
    }
  });

  it("round-trips a d-tag containing a slash (with relay)", () => {
    const repoId = `${HEX_PUBKEY}/vortex-sidecar`;
    const { parsed } = roundTrip(HEX_PUBKEY, repoId, ["wss://relay.damus.io"]);
    expect(parsed?.repoId).toBe(repoId);
    if (parsed?.type === "npub") {
      expect(parsed.pubkey).toBe(HEX_PUBKEY);
      expect(parsed.relayHints).toHaveLength(1);
    }
  });

  it("round-trips a d-tag containing a slash (no relay)", () => {
    const repoId = `${HEX_PUBKEY}/vortex-sidecar`;
    const { parsed } = roundTrip(HEX_PUBKEY, repoId, []);
    expect(parsed?.repoId).toBe(repoId);
    if (parsed?.type === "npub") {
      expect(parsed.pubkey).toBe(HEX_PUBKEY);
    }
  });

  it("round-trips a d-tag with a space", () => {
    const { parsed } = roundTrip(HEX_PUBKEY, "my cool repo", []);
    expect(parsed?.repoId).toBe("my cool repo");
  });

  it("round-trips with a nip05 address as identity", () => {
    const { parsed } = roundTrip(HEX_PUBKEY, "my-repo", [], "user@domain.com");
    expect(parsed?.repoId).toBe("my-repo");
    expect(parsed?.type).toBe("nip05");
    if (parsed?.type === "nip05") {
      expect(parsed.nip05).toBe("user@domain.com");
    }
  });

  it("round-trips a d-tag with an emoji", () => {
    const { parsed } = roundTrip(HEX_PUBKEY, "my\u{1F3B8}repo", []);
    expect(parsed?.repoId).toBe("my\u{1F3B8}repo");
  });

  it("known gap: ws:// relay scheme is lost through repoToPath (becomes wss://)", () => {
    // repoToPath strips both wss:// and ws:// via /^wss?:\/\// so the hint
    // is stored without a scheme. On parse, normalizeRelayHint adds wss:// back.
    const { path, parsed } = roundTrip(HEX_PUBKEY, "my-repo", [
      "ws://relay.example.com",
    ]);
    // The path uses the hint without any scheme
    expect(path).toContain("relay.example.com");
    expect(path).not.toContain("ws://");
    // The relay comes back as wss:// — the ws:// scheme has been lost
    if (parsed?.type === "npub" && parsed.relayHints.length > 0) {
      expect(parsed.relayHints[0]).toMatch(/^wss:\/\//);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. relayUrlToSegment
// ---------------------------------------------------------------------------

describe("relayUrlToSegment", () => {
  it("strips wss:// leaving just the host", () => {
    expect(relayUrlToSegment("wss://relay.damus.io")).toBe("relay.damus.io");
  });

  it("strips wss:// and trailing slash", () => {
    expect(relayUrlToSegment("wss://relay.damus.io/")).toBe("relay.damus.io");
  });

  it("URL-encodes ws:// URLs so the scheme survives in the path", () => {
    expect(relayUrlToSegment("ws://relay.example.com")).toBe(
      "ws%3A%2F%2Frelay.example.com",
    );
  });
});

// ---------------------------------------------------------------------------
// 10. parseRelayUrl
// ---------------------------------------------------------------------------

describe("parseRelayUrl", () => {
  it("normalises a bare domain to a wss:// URL", () => {
    expect(parseRelayUrl("relay.damus.io")).toBe("wss://relay.damus.io/");
  });

  it("normalises a full wss:// URL (adds trailing slash)", () => {
    expect(parseRelayUrl("wss://relay.damus.io")).toBe("wss://relay.damus.io/");
  });

  it("decodes and normalises a ws%3A%2F%2F-encoded URL to ws://", () => {
    expect(parseRelayUrl("ws%3A%2F%2Frelay.example.com")).toBe(
      "ws://relay.example.com/",
    );
  });
});

// ---------------------------------------------------------------------------
// 11. relayUrlToSegment + parseRelayUrl round-trips
// ---------------------------------------------------------------------------

describe("relayUrlToSegment → parseRelayUrl round-trip", () => {
  it("round-trips wss://relay.damus.io", () => {
    const seg = relayUrlToSegment("wss://relay.damus.io");
    expect(parseRelayUrl(seg)).toBe("wss://relay.damus.io/");
  });

  it("round-trips wss://relay.damus.io/ (trailing slash stripped then restored)", () => {
    const seg = relayUrlToSegment("wss://relay.damus.io/");
    expect(parseRelayUrl(seg)).toBe("wss://relay.damus.io/");
  });

  it("round-trips ws://relay.example.com preserving the ws:// scheme", () => {
    const seg = relayUrlToSegment("ws://relay.example.com");
    expect(parseRelayUrl(seg)).toBe("ws://relay.example.com/");
  });
});
