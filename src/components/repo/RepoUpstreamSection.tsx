import { Link } from "react-router-dom";
import { ExternalLink, GitBranch } from "lucide-react";
import { parseRepoCoordinate, type RepoUpstream } from "@/lib/nip34";
import { repoToPath } from "@/lib/routeUtils";

function shortenNip19InUrl(url: string): string {
  const shortened = url.replace(
    /\b(npub1|nsec1|note1|nevent1|naddr1|nprofile1)([0-9a-z]+)/g,
    (_, prefix: string, rest: string) => {
      const full = prefix + rest;
      if (full.length <= 16) return full;
      return full.slice(0, 10) + "…" + full.slice(-4);
    },
  );
  if (shortened.length > 60) {
    return shortened.slice(0, 57) + "…";
  }
  return shortened;
}

export function RepoUpstreamSection({
  upstreams,
  compact = false,
}: {
  upstreams: RepoUpstream[];
  compact?: boolean;
}) {
  if (upstreams.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
        <GitBranch className="h-3 w-3" />
        Fork of
      </p>
      <div className="space-y-1.5">
        {upstreams.map((upstream, index) => {
          const parsed = parseRepoCoordinate(upstream.repository);
          const relayHints = upstream.relayHint ? [upstream.relayHint] : [];
          const repoPath = parsed
            ? repoToPath(parsed.pubkey, parsed.identifier, relayHints)
            : undefined;

          return (
            <div
              key={`${upstream.repository ?? ""}:${upstream.gitUrl ?? ""}:${index}`}
              className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 space-y-1"
            >
              {repoPath && parsed ? (
                <Link
                  to={repoPath}
                  className="text-xs text-pink-600 dark:text-pink-400 hover:underline font-mono break-all"
                  title={upstream.repository}
                >
                  {compact ? parsed.identifier : upstream.repository}
                </Link>
              ) : upstream.repository ? (
                <code className="block text-xs text-foreground/80 break-all">
                  {upstream.repository}
                </code>
              ) : null}

              {upstream.gitUrl ? (
                <a
                  href={upstream.gitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  title={upstream.gitUrl}
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono">
                    {shortenNip19InUrl(upstream.gitUrl)}
                  </span>
                </a>
              ) : null}

              {(upstream.relayHint || upstream.authorPubkey) && !compact ? (
                <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground/70">
                  {upstream.relayHint ? (
                    <span className="font-mono">{upstream.relayHint}</span>
                  ) : null}
                  {upstream.authorPubkey ? (
                    <span className="font-mono">
                      author {upstream.authorPubkey.slice(0, 8)}…
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
