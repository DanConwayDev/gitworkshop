import { nip19 } from "nostr-tools";
import {
  REPO_KIND,
  emptyRepoUpstream,
  parseRepoCoordinate,
  repoCoordinate,
  type RepoUpstream,
} from "@/lib/nip34";
import { parseRepoRoute } from "@/lib/routeUtils";

export interface PendingNip05Upstream {
  nip05: string;
  repoId: string;
  relayHint: string;
  gitUrl: string;
}

export interface ParsedUpstreamInput {
  upstream: RepoUpstream;
  pendingNip05?: Omit<PendingNip05Upstream, "gitUrl">;
}

type ParsedRepoLink =
  | { type: "resolved"; upstream: RepoUpstream }
  | {
      type: "nip05";
      nip05: string;
      repoId: string;
      relayHint: string;
    };

function parseNaddrUpstream(input: string): RepoUpstream | undefined {
  const match = input.match(/\b(naddr1[023456789acdefghjklmnpqrstuvwxyz]+)\b/i);
  if (!match) return undefined;

  try {
    const decoded = nip19.decode(match[1].toLowerCase());
    if (decoded.type !== "naddr" || decoded.data.kind !== REPO_KIND) {
      return undefined;
    }

    return {
      repository: repoCoordinate(decoded.data.pubkey, decoded.data.identifier),
      relayHint: decoded.data.relays?.[0] ?? "",
      authorPubkey: decoded.data.pubkey,
      gitUrl: "",
    };
  } catch {
    return undefined;
  }
}

function parsedRouteToRepoLink(
  parsed: ReturnType<typeof parseRepoRoute>,
): ParsedRepoLink | undefined {
  if (!parsed) return undefined;

  if (parsed.type === "npub") {
    return {
      type: "resolved",
      upstream: {
        repository: repoCoordinate(parsed.pubkey, parsed.repoId),
        relayHint: parsed.relayHints[0] ?? "",
        authorPubkey: parsed.pubkey,
        gitUrl: "",
      },
    };
  }

  return {
    type: "nip05",
    nip05: parsed.nip05,
    repoId: parsed.repoId,
    relayHint: parsed.relayHints[0] ?? "",
  };
}

function parseRepoPathUpstream(path: string): ParsedRepoLink | undefined {
  const segments = path.split("/").filter(Boolean);

  for (let index = 0; index < segments.length - 1; index++) {
    for (const width of [3, 2]) {
      const candidate = segments.slice(index, index + width).join("/");
      const parsed = parsedRouteToRepoLink(parseRepoRoute(candidate));
      if (parsed) return parsed;
    }
  }

  return undefined;
}

function parseNostrCloneUpstream(input: string): ParsedRepoLink | undefined {
  const match = input.match(/\bnostr:\/\/\S+/i);
  if (!match) return undefined;

  try {
    const url = new URL(match[0]);
    return parseRepoPathUpstream(`${url.hostname}${url.pathname}`);
  } catch {
    return undefined;
  }
}

function isGitworkshopHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "gitworkshop.dev" || lower === "www.gitworkshop.dev";
}

function normalizeGitworkshopRepoPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();
  const withoutHost =
    first === "gitworkshop.dev" || first === "www.gitworkshop.dev"
      ? segments.slice(1)
      : segments;
  const prefix = withoutHost[0];

  if (prefix === "r" || prefix === "p") return withoutHost.slice(1).join("/");
  return withoutHost.join("/");
}

function parseWebRepoPathUpstream(input: string): ParsedRepoLink | undefined {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.pathname.endsWith(".git")) return undefined;
    const path = isGitworkshopHost(url.hostname)
      ? normalizeGitworkshopRepoPath(url.pathname)
      : url.pathname;
    return parseRepoPathUpstream(path);
  } catch {
    return parseRepoPathUpstream(normalizeGitworkshopRepoPath(input));
  }
}

function parseCoordinateUpstream(input: string): RepoUpstream | undefined {
  const target = input.split("|")[0]?.trim();
  const parsed = parseRepoCoordinate(target);
  if (!parsed || !target) return undefined;

  return {
    repository: target,
    relayHint: "",
    authorPubkey: parsed.pubkey,
    gitUrl: "",
  };
}

function extractGitUrl(input: string, hasRepoLink: boolean): string {
  const match = input.match(/\b(?:https?|ssh|git):\/\/\S+|\bgit@\S+/i);
  const raw = match?.[0]?.replace(/[),.;]+$/, "") ?? "";
  if (!raw) return "";

  if (!hasRepoLink) return raw;
  if (raw.endsWith(".git") || raw.includes(".git?")) return raw;
  return "";
}

export function parseUpstreamInput(input: string): ParsedUpstreamInput {
  const trimmed = input.trim();
  if (!trimmed) return { upstream: emptyRepoUpstream() };

  const repoLink =
    (() => {
      const naddr = parseNaddrUpstream(trimmed);
      return naddr
        ? ({ type: "resolved", upstream: naddr } as const)
        : undefined;
    })() ??
    parseNostrCloneUpstream(trimmed) ??
    (() => {
      const coordinate = parseCoordinateUpstream(trimmed);
      return coordinate
        ? ({ type: "resolved", upstream: coordinate } as const)
        : undefined;
    })() ??
    parseWebRepoPathUpstream(trimmed);
  const gitUrl = extractGitUrl(trimmed, !!repoLink);

  if (repoLink?.type === "resolved") {
    return {
      upstream: {
        ...repoLink.upstream,
        gitUrl,
      },
    };
  }

  if (repoLink?.type === "nip05") {
    return {
      upstream: {
        repository: "",
        relayHint: repoLink.relayHint,
        authorPubkey: "",
        gitUrl,
      },
      pendingNip05: repoLink,
    };
  }

  return {
    upstream: {
      repository: "",
      relayHint: "",
      authorPubkey: "",
      gitUrl,
    },
  };
}

export function formatUpstreamInput(upstream: RepoUpstream): string {
  const parts: string[] = [];
  const parsed = parseRepoCoordinate(upstream.repository);

  if (parsed) {
    const npub = nip19.npubEncode(parsed.pubkey);
    const relayHint = upstream.relayHint
      ?.replace(/^wss?:\/\//, "")
      .replace(/\/$/, "");
    const encodedIdentifier = encodeURIComponent(parsed.identifier);
    parts.push(
      relayHint
        ? `nostr://${npub}/${relayHint}/${encodedIdentifier}`
        : `nostr://${npub}/${encodedIdentifier}`,
    );
  } else if (upstream.repository) {
    parts.push(upstream.repository);
  }

  if (upstream.gitUrl) parts.push(upstream.gitUrl);
  return parts.join(" ");
}
