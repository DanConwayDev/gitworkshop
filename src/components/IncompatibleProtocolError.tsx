/**
 * IncompatibleProtocolError — shown when all of a repo's clone URLs use
 * protocols (SSH, git://, etc.) that browsers cannot fetch directly.
 *
 * HTTP/HTTPS is the only protocol accessible from a web browser. SSH, the
 * git:// protocol, and SCP-style `git@host:path` addresses all require a
 * native git client and are invisible to fetch().
 *
 * Special case: htree:// URLs are served by the HashTree protocol. We show a
 * tailored message pointing users to hashtree.cc and the repo on git.iris.to.
 */

import { AlertCircle, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { nip19 } from "nostr-tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the protocol label from a URL for display purposes.
 * Returns "SSH" for ssh:// and git@ addresses, the scheme for others.
 */
function protocolLabel(url: string): string {
  if (url.startsWith("git@") || (url.includes("@") && url.includes(":"))) {
    return "SSH";
  }
  try {
    const scheme = new URL(url).protocol.replace(":", "").toUpperCase();
    if (scheme === "SSH") return "SSH";
    return scheme;
  } catch {
    return "SSH";
  }
}

/** Returns true if every URL in the list uses the htree: scheme. */
function allHtree(urls: string[]): boolean {
  return (
    urls.length > 0 &&
    urls.every((u) => {
      try {
        return new URL(u).protocol === "htree:";
      } catch {
        return false;
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface IncompatibleProtocolErrorProps {
  /** The clone URLs that were found to be non-HTTP. */
  cloneUrls: string[];
  /**
   * Optional context label for where the error is shown,
   * e.g., "code browser" or "commit history". Omit for a generic message.
   */
  context?: string;
  className?: string;
  /** Hex pubkey of the repo maintainer — used to build the git.iris.to link. */
  pubkey?: string;
  /** Repository identifier (d-tag) — used to build the git.iris.to link. */
  repoId?: string;
}

/**
 * Error card shown when all clone URLs use incompatible browser protocols.
 */
export function IncompatibleProtocolError({
  cloneUrls,
  context,
  className,
  pubkey,
  repoId,
}: IncompatibleProtocolErrorProps) {
  const label = context ? `the ${context}` : "this repository";
  const isHashtree = allHtree(cloneUrls);

  // Build git.iris.to link when we have the necessary identifiers
  const irisUrl =
    pubkey && repoId
      ? `https://git.iris.to/#/${nip19.npubEncode(pubkey)}/${repoId}`
      : undefined;

  if (isHashtree) {
    return (
      <Card className={className ?? "border-amber-500/30"}>
        <CardContent className="py-8 px-6">
          <div className="flex flex-col items-center text-center gap-4 max-w-lg mx-auto">
            <div className="flex items-center justify-center h-12 w-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-6 w-6" />
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-base">
                Browser can&apos;t access {label}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This repository uses the{" "}
                <a
                  href="https://hashtree.cc/#/dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-pink-600 dark:text-pink-400 hover:underline"
                >
                  hashtree
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                protocol, which browsers cannot access directly.
              </p>
            </div>

            {cloneUrls.length > 0 && (
              <div className="w-full space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-left">
                  Clone URLs
                </p>
                <div className="space-y-1">
                  {cloneUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                    >
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4 px-1.5 shrink-0 text-amber-600 border-amber-500/40 bg-amber-500/10"
                      >
                        HTREE
                      </Badge>
                      <code className="font-mono text-xs text-muted-foreground truncate min-w-0">
                        {url}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {irisUrl && (
              <p className="text-xs text-muted-foreground">
                You can view this repository on{" "}
                <a
                  href={irisUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-pink-600 dark:text-pink-400 hover:underline"
                >
                  git.iris.to
                  <ExternalLink className="h-3 w-3" />
                </a>
                .
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className ?? "border-amber-500/30"}>
      <CardContent className="py-8 px-6">
        <div className="flex flex-col items-center text-center gap-4 max-w-lg mx-auto">
          <div className="flex items-center justify-center h-12 w-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-6 w-6" />
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-base">
              Browser can&apos;t access {label}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              All clone URLs use SSH or other non-HTTP protocols which can only
              be accessed with a native git client — browsers cannot fetch them
              directly.
            </p>
          </div>

          {cloneUrls.length > 0 && (
            <div className="w-full space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-left">
                Incompatible URLs
              </p>
              <div className="space-y-1">
                {cloneUrls.map((url) => (
                  <div
                    key={url}
                    className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                  >
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1.5 shrink-0 text-amber-600 border-amber-500/40 bg-amber-500/10"
                    >
                      {protocolLabel(url)}
                    </Badge>
                    <code className="font-mono text-xs text-muted-foreground truncate min-w-0">
                      {url}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            To view this repo on the web, the maintainer needs to add an
            HTTPS-accessible mirror (e.g. on GitHub, Gitea, or a Grasp server).{" "}
            <a
              href="https://gitworkshop.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-pink-600 dark:text-pink-400 hover:underline"
            >
              Learn more
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
