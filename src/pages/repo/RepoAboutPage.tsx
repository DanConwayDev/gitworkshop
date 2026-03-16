import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GitBranch,
  Globe,
  Copy,
  Check,
  Users,
  Tag,
  Radio,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function RepoAboutPage() {
  const { resolved } = useRepoContext();
  const repo = resolved?.repo;

  useSeoMeta({
    title: repo ? `${repo.name} - ngit` : "Repository - ngit",
    description: repo?.description ?? "Repository details",
  });

  if (!repo) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main content */}
        <div className="space-y-6">
          {/* Description */}
          {repo.description && (
            <Card>
              <CardContent className="p-6">
                <p className="text-base leading-relaxed text-foreground/90">
                  {repo.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Clone URLs */}
          {repo.cloneUrls.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  Clone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {repo.cloneUrls.map((url) => (
                  <CloneUrlRow key={url} url={url} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Web URLs */}
          {repo.webUrls.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Web
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {repo.webUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    {url}
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Maintainers */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Maintainers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {repo.maintainerSet.map((pk) => (
                <UserLink
                  key={pk}
                  pubkey={pk}
                  avatarSize="md"
                  nameClassName="text-sm"
                />
              ))}
              {repo.pendingMaintainers.length > 0 && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    Pending (no announcement)
                  </p>
                  {repo.pendingMaintainers.map((pk) => (
                    <UserLink
                      key={pk}
                      pubkey={pk}
                      avatarSize="sm"
                      nameClassName="text-xs text-muted-foreground"
                    />
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          {/* Labels */}
          {repo.labels.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  Topics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {repo.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-xs">
                      {label}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Relays */}
          {repo.relays.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Radio className="h-4 w-4 text-muted-foreground" />
                  Relays
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {repo.relays.map((relay) => (
                    <p
                      key={relay}
                      className="text-xs text-muted-foreground font-mono truncate"
                      title={relay}
                    >
                      {relay}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function CloneUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <code className="flex-1 text-sm font-mono truncate text-foreground/80">
        {url}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
