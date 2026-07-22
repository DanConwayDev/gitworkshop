import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import {
  ArrowLeft,
  Bell,
  Bot,
  CheckCircle2,
  Filter,
  GitPullRequest,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Activity = {
  author: string;
  handle: string;
  initials: string;
  color: string;
  action: string;
  subject: string;
  repository: string;
  time: string;
  count?: number;
};

const activities: Activity[] = [
  {
    author: "release-bot",
    handle: "@release-bot",
    initials: "RB",
    color: "bg-violet-500",
    action: "commented on",
    subject: "Update Android release notes",
    repository: "gitworkshop",
    time: "12m",
    count: 35,
  },
  {
    author: "Sofia Chen",
    handle: "@sofia",
    initials: "SC",
    color: "bg-emerald-600",
    action: "requested changes on",
    subject: "Add local draft recovery",
    repository: "gitworkshop",
    time: "48m",
  },
  {
    author: "Milo Harper",
    handle: "@milo",
    initials: "MH",
    color: "bg-orange-500",
    action: "commented on",
    subject: "Respect relay auth challenge timeout",
    repository: "relay-tools",
    time: "2h",
  },
];

function MockAvatar({
  activity,
  small = false,
}: {
  activity: Activity;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        small ? "h-7 w-7 text-[10px]" : "h-10 w-10 text-xs",
        activity.color,
      )}
      aria-label={activity.author}
    >
      {activity.initials}
    </span>
  );
}

function UnreadDot() {
  return (
    <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-pink-500 ring-4 ring-pink-500/15" />
  );
}

function Subject({ activity }: { activity: Activity }) {
  return (
    <>
      <span className="text-muted-foreground">{activity.action}</span>{" "}
      <span className="font-medium text-foreground">{activity.subject}</span>
    </>
  );
}

function OptionCard({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="flex items-start gap-3">
          <Badge variant="secondary" className="mt-0.5 font-mono">
            {number}
          </Badge>
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="bg-background p-0">{children}</CardContent>
    </Card>
  );
}

export default function NotificationMockupsPage() {
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const selectedActivities = selectedAuthor
    ? activities.filter((activity) => activity.author === selectedAuthor)
    : activities;

  useSeoMeta({
    title: "Notification unread-state mockups - ngit",
    description:
      "Explorations for clearer unread notification activity authors",
  });

  return (
    <div className="container max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 mb-6 text-muted-foreground"
      >
        <Link to="/notifications">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to notifications
        </Link>
      </Button>

      <header className="mb-10 max-w-3xl space-y-3">
        <div className="flex items-center gap-2 text-pink-600 dark:text-pink-400">
          <Bell className="h-5 w-5" />
          <span className="text-sm font-semibold">Design exploration</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Make the unread actor impossible to miss
        </h1>
        <p className="text-base leading-7 text-muted-foreground md:text-lg">
          These alternatives separate the person who generated unread activity
          from your own identity and the repository context. Each uses the same
          example: a bot has left activity across 35 of your pull requests.
        </p>
      </header>

      <div className="mb-8 rounded-xl border border-pink-500/20 bg-pink-500/5 p-4 text-sm text-muted-foreground">
        <div className="flex gap-3">
          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-pink-600 dark:text-pink-400" />
          <p>
            <strong className="text-foreground">The current pain:</strong> the
            item title and repo badge dominate the row while activity authors
            are reduced to small avatars at the far right. The following options
            make actor identity a primary scanning cue.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <OptionCard
          number="01"
          title="Actor-first row"
          description="Put the latest unread actor at the left, with their name leading the sentence. Repository context remains compact and text-only."
        >
          <ul className="divide-y divide-border/60">
            {activities.map((activity) => (
              <li
                key={activity.author}
                className="flex gap-3 bg-pink-500/[0.035] px-4 py-4"
              >
                <UnreadDot />
                <MockAvatar activity={activity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-5">
                    <strong>{activity.author}</strong>{" "}
                    <Subject activity={activity} />
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <GitPullRequest className="h-3.5 w-3.5 text-pink-500" />
                    <span>{activity.repository}</span>
                    <span>·</span>
                    <span>{activity.time} ago</span>
                    {activity.count && (
                      <Badge variant="secondary">{activity.count} unread</Badge>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </OptionCard>

        <OptionCard
          number="02"
          title="Unread people filter"
          description="Turn the authors behind unread work into immediately actionable filters. The list stays familiar, but the filter answers “who needs my attention?”"
        >
          <div className="border-b bg-muted/20 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Unread activity from
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={selectedAuthor === null ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSelectedAuthor(null)}
              >
                All{" "}
                <Badge className="ml-1.5 bg-background text-foreground hover:bg-background">
                  37
                </Badge>
              </Button>
              {activities.map((activity) => (
                <Button
                  key={activity.author}
                  variant={
                    selectedAuthor === activity.author ? "secondary" : "outline"
                  }
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setSelectedAuthor(activity.author)}
                >
                  <MockAvatar activity={activity} small />
                  {activity.author}
                  {activity.count && (
                    <Badge className="bg-background text-foreground hover:bg-background">
                      {activity.count}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          </div>
          <ul className="divide-y divide-border/60">
            {selectedActivities.map((activity) => (
              <li
                key={activity.author}
                className="flex items-center gap-3 px-4 py-3.5"
              >
                <UnreadDot />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{activity.subject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong className="font-medium text-foreground">
                      {activity.author}
                    </strong>{" "}
                    {activity.action} · {activity.repository} · {activity.time}{" "}
                    ago
                  </p>
                </div>
                {activity.count && (
                  <span className="text-xs font-medium text-pink-600 dark:text-pink-400">
                    {activity.count} items
                  </span>
                )}
              </li>
            ))}
          </ul>
        </OptionCard>

        <OptionCard
          number="03"
          title="Activity lane"
          description="A dedicated, tinted author lane makes unread origin visible while preserving subject-first scanning in the main content column."
        >
          <ul className="divide-y divide-border/60">
            {activities.map((activity) => (
              <li
                key={activity.author}
                className="grid grid-cols-[9.25rem_1fr] sm:grid-cols-[11rem_1fr]"
              >
                <div className="flex items-center gap-2 border-r bg-pink-500/[0.07] px-3 py-4">
                  <UnreadDot />
                  <MockAvatar activity={activity} small />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      {activity.author}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {activity.handle}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 px-4 py-4">
                  <p className="text-sm font-medium">{activity.subject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activity.action} ·{" "}
                    <span className="font-medium text-foreground">
                      {activity.repository}
                    </span>{" "}
                    · {activity.time} ago
                  </p>
                  {activity.count && (
                    <Badge variant="secondary" className="mt-2">
                      35 unread PRs from this bot
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </OptionCard>

        <OptionCard
          number="04"
          title="Unread activity digest"
          description="Group noisy activity by author before showing individual threads. This minimizes bot floods and lets the user clear a whole source deliberately."
        >
          <div className="p-4">
            <div className="rounded-lg border border-pink-500/25 bg-pink-500/[0.06] p-4">
              <div className="flex items-start gap-3">
                <UnreadDot />
                <MockAvatar activity={activities[0]} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-semibold">release-bot</p>
                    <Badge className="bg-pink-600 hover:bg-pink-600">
                      35 unread activities
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Commented on 35 pull requests you authored in{" "}
                    <strong className="font-medium text-foreground">
                      gitworkshop
                    </strong>
                    .
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm">Review activity</Button>
                    <Button size="sm" variant="ghost">
                      Mark this group read
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>2 other people have unread activity</span>
              <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <MockAvatar activity={activities[1]} small />
              <p className="text-sm">
                <strong>Sofia Chen</strong> requested changes on{" "}
                <span className="text-muted-foreground">
                  Add local draft recovery
                </span>
              </p>
            </div>
          </div>
        </OptionCard>
      </div>

      <section className="mt-10 rounded-xl border border-dashed p-5 md:p-6">
        <h2 className="text-lg font-semibold">Comparison notes</h2>
        <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="font-medium">Most direct individual-row fix</dt>
            <dd className="mt-1 text-muted-foreground">
              Option 01 changes hierarchy without adding a new interaction
              model.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Best for finding a specific person</dt>
            <dd className="mt-1 text-muted-foreground">
              Option 02 gives unread authors a persistent control at the top of
              the inbox.
            </dd>
          </div>
          <div>
            <dt className="font-medium">
              Best balance of context and scanability
            </dt>
            <dd className="mt-1 text-muted-foreground">
              Option 03 retains subject-first reading while making every
              activity author explicit.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Best protection against bot floods</dt>
            <dd className="mt-1 text-muted-foreground">
              Option 04 treats many events from one actor as a reviewable group
              instead of 35 competing rows.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
