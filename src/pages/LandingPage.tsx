/**
 * LandingPage — shown to logged-out visitors on the root route.
 *
 * Sections:
 *   1. Hero — headline, sub-headline, two CTAs
 *   2. Featured repos strip — live repos from git index relays
 *   3. How it works — 3-step explainer
 *   4. Feature highlights — why ngit
 *   5. Footer CTA — repeat the two buttons
 */

import { Link } from "react-router-dom";
import {
  GitBranch,
  GitCommitHorizontal,
  Terminal,
  Search,
  Shield,
  Key,
  Globe,
  ArrowRight,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useRepositorySearch } from "@/hooks/useRepositorySearch";
import { useRepoPath } from "@/hooks/useRepoPath";
import { UserLink } from "@/components/UserAvatar";
import { formatDistanceToNow } from "date-fns";
import type { ResolvedRepo } from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Featured repos strip
// ---------------------------------------------------------------------------

function FeaturedRepoCard({ repo }: { repo: ResolvedRepo }) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  return (
    <Link to={repoPath} className="group block h-full">
      <Card className="h-full transition-all duration-200 hover:shadow-md hover:shadow-pink-500/5 hover:border-pink-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-4 flex flex-col h-full">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1 rounded bg-gradient-to-br from-pink-500/10 to-pink-500/5 shrink-0">
              <GitBranch className="h-3.5 w-3.5 text-pink-500" />
            </div>
            <h3 className="font-semibold text-sm truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
              {repo.name}
            </h3>
          </div>

          {repo.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3 flex-1">
              {repo.description}
            </p>
          )}

          <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/30">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {repo.maintainerSet.slice(0, 2).map((pk) => (
                <UserLink
                  key={pk}
                  pubkey={pk}
                  avatarSize="xs"
                  nameClassName="text-[10px] text-muted-foreground"
                  noLink
                />
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground/60 shrink-0">
              {timeAgo}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function FeaturedReposSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="h-full">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-6 w-6 rounded" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-3 w-full mb-1" />
            <Skeleton className="h-3 w-3/4 mb-3" />
            <div className="flex items-center gap-2 pt-2 border-t border-border/30">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function FeaturedRepos() {
  const { repos, isLoading } = useRepositorySearch("");

  const graspRepos = repos?.filter((r) => r.graspCloneUrls.length > 0);
  const showSkeletons =
    graspRepos === undefined || (isLoading && graspRepos.length === 0);
  const featured = graspRepos?.slice(0, 6) ?? [];

  return (
    <section className="py-16 border-t border-border/40">
      <div className="container max-w-screen-xl px-4 md:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold mb-1">
              Recently created repositories
            </h2>
            <p className="text-muted-foreground text-sm">
              Live from the Nostr git index — no central server required
            </p>
          </div>
          <Button variant="outline" asChild className="hidden sm:flex">
            <Link to="/search">
              Browse all
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {showSkeletons ? (
            <FeaturedReposSkeleton />
          ) : featured.length > 0 ? (
            featured.map((repo) => (
              <FeaturedRepoCard
                key={`${repo.selectedMaintainer}:${repo.dTag}`}
                repo={repo}
              />
            ))
          ) : (
            <div className="col-span-full text-center py-8 text-muted-foreground text-sm">
              No repositories found. Check your relay connections.
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-center sm:hidden">
          <Button variant="outline" asChild>
            <Link to="/search">
              Browse all repositories
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

const HOW_IT_WORKS_STEPS = [
  {
    number: "01",
    icon: Terminal,
    title: "Install the ngit CLI",
    description:
      "One command installs both ngit and git-remote-nostr. Works on macOS, Linux, and Windows.",
    cta: { label: "Install ngit", to: "/ngit" },
  },
  {
    number: "02",
    icon: GitCommitHorizontal,
    title: "Push your repo to Nostr",
    description:
      "Run ngit init in any git repo. Your code is published to Nostr relays — no account signup, just your keypair.",
    cta: null,
  },
  {
    number: "03",
    icon: Users,
    title: "Collaborate over Nostr",
    description:
      "Issues, pull requests, and patches all flow through Nostr. Anyone with ngit can contribute — from any client.",
    cta: null,
  },
];

function HowItWorks() {
  return (
    <section className="py-16 border-t border-border/40">
      <div className="container max-w-screen-xl px-4 md:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold mb-2">How it works</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Three steps from zero to decentralized collaboration
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connector lines on desktop */}
          <div className="hidden md:block absolute top-8 left-1/3 right-1/3 h-px bg-gradient-to-r from-pink-500/20 via-pink-500/40 to-pink-500/20" />

          {HOW_IT_WORKS_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="relative flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-pink-500/15 to-pink-500/5 border border-pink-500/20">
                      <Icon className="h-6 w-6 text-pink-500" />
                    </div>
                    <span className="absolute -top-2 -right-2 text-[10px] font-bold text-pink-500/60 font-mono">
                      {step.number}
                    </span>
                  </div>
                  <h3 className="font-semibold text-base">{step.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
                {step.cta && (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="self-start mt-auto border-pink-500/30 hover:border-pink-500/60 hover:bg-pink-500/5"
                  >
                    <Link to={step.cta.to}>
                      {step.cta.label}
                      <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                    </Link>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Feature highlights
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    icon: Shield,
    title: "No central server",
    description:
      "Your code lives on Nostr relays you choose. No single point of failure, no platform that can shut you down.",
  },
  {
    icon: GitBranch,
    title: "Standard git workflow",
    description:
      "Push, pull, branch, merge — exactly as you do today. ngit adds Nostr transport without changing how you work.",
  },
  {
    icon: Key,
    title: "Your identity travels with you",
    description:
      "A Nostr keypair is your identity. Use it across gitworkshop.dev, ngit CLI, and any other Nostr git client.",
  },
  {
    icon: Globe,
    title: "Open ecosystem",
    description:
      "Compatible with gitworkshop.dev and any client that speaks NIP-34. Your repos are readable by the whole network.",
  },
  {
    icon: Zap,
    title: "Censorship-resistant",
    description:
      "No account to ban, no repo to take down. Publish to multiple relays for redundancy and resilience.",
  },
  {
    icon: Users,
    title: "Permissionless collaboration",
    description:
      "Anyone can open issues and submit patches — no need to request access or create an account on your platform.",
  },
];

function FeatureHighlights() {
  return (
    <section className="py-16 border-t border-border/40">
      <div className="container max-w-screen-xl px-4 md:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold mb-2">Why ngit?</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Git collaboration that belongs to you, not a platform
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="flex gap-4 p-4 rounded-xl border border-border/40 bg-card/50 hover:border-pink-500/20 hover:bg-card transition-colors"
              >
                <div className="shrink-0 mt-0.5">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-gradient-to-br from-pink-500/15 to-pink-500/5 border border-pink-500/20">
                    <Icon className="h-4 w-4 text-pink-500" />
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer CTA
// ---------------------------------------------------------------------------

function FooterCTA() {
  return (
    <section className="py-20 border-t border-border/40">
      <div className="container max-w-screen-xl px-4 md:px-8">
        <div className="relative rounded-2xl overflow-hidden border border-pink-500/20 bg-gradient-to-br from-pink-500/5 via-background to-background p-10 md:p-16 text-center isolate">
          {/* Decorative glow */}
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-pink-500/10 via-transparent to-transparent" />

          <Badge
            variant="secondary"
            className="mb-4 border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400"
          >
            Open source · MIT licensed
          </Badge>

          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Your repo. Your keypair. No platform.
          </h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
            Push code, track issues, and collaborate — all over Nostr. No
            account to create, no platform to trust.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              asChild
              className="bg-pink-500 hover:bg-pink-600 text-white shadow-lg shadow-pink-500/20"
            >
              <Link to="/ngit">
                <Terminal className="h-5 w-5 mr-2" />
                Install ngit CLI
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/search">
                <Search className="h-5 w-5 mr-2" />
                Browse repositories
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main LandingPage
// ---------------------------------------------------------------------------

export function LandingPage() {
  return (
    <div className="min-h-full">
      {/* Hero */}
      <section className="relative py-20 md:py-28 overflow-hidden isolate">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-pink-500/12 via-pink-500/4 to-transparent" />
        </div>

        <div className="container max-w-screen-xl px-4 md:px-8">
          <div className="max-w-2xl mx-auto text-center">
            {/* Logo mark */}
            <div className="flex justify-center mb-6">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-pink-500/15 to-pink-500/5 border border-pink-500/20 shadow-lg shadow-pink-500/10">
                <GitBranch className="h-10 w-10 text-pink-500" />
              </div>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
              Git collaboration,{" "}
              <span className="bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 dark:from-pink-400 dark:via-pink-400 dark:to-rose-400 bg-clip-text text-transparent">
                without the platform
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground mb-10 leading-relaxed max-w-xl mx-auto">
              Decentralized code collaboration over Nostr and{" "}
              <a
                href="https://gitgrasp.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2 decoration-pink-500/50 hover:decoration-pink-500 transition-colors"
              >
                GRASP
              </a>
              . No GitHub account needed, censorship-resistant, and fully
              compatible with your existing git workflow.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                asChild
                className="bg-pink-500 hover:bg-pink-600 text-white shadow-lg shadow-pink-500/20 text-base"
              >
                <Link to="/search">
                  <Search className="h-5 w-5 mr-2" />
                  Browse repositories
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="text-base">
                <Link to="/ngit">
                  <Terminal className="h-5 w-5 mr-2" />
                  Install ngit CLI
                </Link>
              </Button>
            </div>

            <p className="mt-6 text-xs text-muted-foreground/60">
              Start in your browser · Push code with the ngit CLI
            </p>
          </div>
        </div>
      </section>

      {/* Featured repos */}
      <FeaturedRepos />

      {/* How it works */}
      <HowItWorks />

      {/* Feature highlights */}
      <FeatureHighlights />

      {/* Footer CTA */}
      <FooterCTA />
    </div>
  );
}
