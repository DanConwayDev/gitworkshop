import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import {
  ArrowLeft,
  Bell,
  Check,
  FolderGit2,
  GitPullRequest,
  Layers3,
  MessageCircle,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type GroupMode = "none" | "root" | "author";

type Activity = {
  id: number;
  author: string;
  initials: string;
  avatarColor: string;
  repository: string;
  subject: string;
  action: string;
  time: string;
  newRoot?: boolean;
};

const activities: Activity[] = [
  {
    id: 1,
    author: "release-bot",
    initials: "RB",
    avatarColor: "bg-violet-500",
    repository: "gitworkshop",
    subject: "Update Android release notes",
    action: "commented",
    time: "12m",
  },
  {
    id: 2,
    author: "release-bot",
    initials: "RB",
    avatarColor: "bg-violet-500",
    repository: "gitworkshop",
    subject: "Preserve Amber intent responses",
    action: "commented",
    time: "21m",
  },
  {
    id: 3,
    author: "Sofia Chen",
    initials: "SC",
    avatarColor: "bg-emerald-600",
    repository: "gitworkshop",
    subject: "Add local draft recovery",
    action: "requested changes",
    time: "48m",
    newRoot: true,
  },
  {
    id: 4,
    author: "Milo Harper",
    initials: "MH",
    avatarColor: "bg-orange-500",
    repository: "relay-tools",
    subject: "Respect relay auth challenge timeout",
    action: "commented",
    time: "2h",
  },
];

function Avatar({ activity }: { activity: Activity }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
        activity.avatarColor,
      )}
    >
      {activity.initials}
    </span>
  );
}

function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full bg-pink-500 ring-4 ring-pink-500/15",
        className,
      )}
    />
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

function StatusLabel({
  activity,
  unreadCount = 1,
}: {
  activity: Activity;
  unreadCount?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {activity.newRoot && (
        <span className="font-medium text-pink-600 dark:text-pink-400">
          New PR
        </span>
      )}
      {activity.newRoot && <span className="text-muted-foreground/50">·</span>}
      <UnreadDot className="h-1.5 w-1.5 ring-0" />
      <span className="font-medium text-pink-600 dark:text-pink-400">
        {unreadCount} unread{unreadCount === 1 ? "" : " activities"}
      </span>
    </div>
  );
}

export default function NotificationMockups2Page() {
  const [mode, setMode] = useState<GroupMode>("root");
  const [authors, setAuthors] = useState<string[]>([]);
  const [repositories, setRepositories] = useState<string[]>([]);

  const filteredActivities = useMemo(
    () =>
      activities.filter(
        (activity) =>
          (authors.length === 0 || authors.includes(activity.author)) &&
          (repositories.length === 0 ||
            repositories.includes(activity.repository)),
      ),
    [authors, repositories],
  );

  const toggleFilter = (
    value: string,
    values: string[],
    setValues: (values: string[]) => void,
  ) => {
    setValues(
      values.includes(value)
        ? values.filter((current) => current !== value)
        : [...values, value],
    );
  };

  useSeoMeta({
    title: "Notification grouping mockups - ngit",
    description: "Grouping and filtering explorations for notifications",
  });

  return (
    <div className="container max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 mb-6 text-muted-foreground"
      >
        <Link to="/notifications/mockups">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to mockups
        </Link>
      </Button>

      <header className="mb-10 max-w-3xl space-y-3">
        <div className="flex items-center gap-2 text-pink-600 dark:text-pink-400">
          <Bell className="h-5 w-5" />
          <span className="text-sm font-semibold">Design exploration 02</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Group by the question you need answered
        </h1>
        <p className="text-base leading-7 text-muted-foreground md:text-lg">
          Root-item grouping remains a strong default for normal review. These
          mockups explore making it reversible, adding explicit unread language,
          and combining repository and author filters when the default fails.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <OptionCard
          number="05"
          title="Grouping mode is a view control"
          description="Keep root-item grouping as the default, but give people a simple escape hatch for bot floods or chronological review."
        >
          <div className="border-b bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Layers3 className="h-3.5 w-3.5" />
              Group unread activity by
            </div>
            <div className="mt-2 grid grid-cols-3 rounded-lg border bg-background p-1">
              {(
                [
                  ["none", "None"],
                  ["root", "Root item"],
                  ["author", "Author"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  variant={mode === value ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {mode === "none" && (
            <ul className="divide-y divide-border/60">
              {activities.slice(0, 3).map((activity) => (
                <li
                  key={activity.id}
                  className="flex items-center gap-3 px-4 py-3.5"
                >
                  <UnreadDot />
                  <Avatar activity={activity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <strong>{activity.author}</strong>{" "}
                      <span className="text-muted-foreground">
                        {activity.action} on
                      </span>{" "}
                      <span className="font-medium">{activity.subject}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activity.repository} · {activity.time} ago
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {mode === "root" && (
            <ul className="divide-y divide-border/60">
              <li className="flex items-center gap-3 px-4 py-3.5">
                <UnreadDot />
                <div className="flex -space-x-2">
                  <Avatar activity={activities[0]} />
                  <Avatar activity={activities[1]} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Update Android release notes
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    release-bot commented · gitworkshop · 12m ago
                  </p>
                  <div className="mt-1.5">
                    <StatusLabel activity={activities[0]} unreadCount={2} />
                  </div>
                </div>
              </li>
              <li className="flex items-center gap-3 px-4 py-3.5">
                <UnreadDot />
                <Avatar activity={activities[2]} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Add local draft recovery
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sofia Chen requested changes · gitworkshop · 48m ago
                  </p>
                  <div className="mt-1.5">
                    <StatusLabel activity={activities[2]} unreadCount={2} />
                  </div>
                </div>
              </li>
            </ul>
          )}
          {mode === "author" && (
            <ul className="divide-y divide-border/60">
              <li className="flex items-center gap-3 px-4 py-4">
                <UnreadDot />
                <Avatar activity={activities[0]} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">release-bot</p>
                    <Badge variant="secondary">35 unread</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Commented across 35 pull requests in gitworkshop.
                  </p>
                </div>
              </li>
              <li className="flex items-center gap-3 px-4 py-4">
                <UnreadDot />
                <Avatar activity={activities[2]} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Sofia Chen</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    2 unread activities across 1 pull request.
                  </p>
                </div>
              </li>
            </ul>
          )}
        </OptionCard>

        <OptionCard
          number="06"
          title="Composable filters, not a single fork"
          description="Repository and actor filters can be applied together. They answer different questions, so both stay visible as removable chips."
        >
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Narrow unread activity
              </div>
              <div className="flex flex-wrap gap-2">
                {authors.map((author) => (
                  <Button
                    key={author}
                    size="sm"
                    variant="secondary"
                    onClick={() => toggleFilter(author, authors, setAuthors)}
                  >
                    <UserRound className="mr-1.5 h-3.5 w-3.5" />
                    {author}
                    <span className="ml-1 text-muted-foreground">×</span>
                  </Button>
                ))}
                {repositories.map((repository) => (
                  <Button
                    key={repository}
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      toggleFilter(repository, repositories, setRepositories)
                    }
                  >
                    <FolderGit2 className="mr-1.5 h-3.5 w-3.5" />
                    {repository}
                    <span className="ml-1 text-muted-foreground">×</span>
                  </Button>
                ))}
                {authors.length === 0 && repositories.length === 0 && (
                  <span className="py-1 text-xs text-muted-foreground">
                    All unread activity
                  </span>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" /> Activity author
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["release-bot", "Sofia Chen", "Milo Harper"].map(
                    (author) => (
                      <Button
                        key={author}
                        size="sm"
                        variant={
                          authors.includes(author) ? "secondary" : "outline"
                        }
                        className="h-7 text-xs"
                        onClick={() =>
                          toggleFilter(author, authors, setAuthors)
                        }
                      >
                        {authors.includes(author) && (
                          <Check className="mr-1 h-3 w-3" />
                        )}
                        {author}
                      </Button>
                    ),
                  )}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FolderGit2 className="h-3.5 w-3.5" /> Repository
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["gitworkshop", "relay-tools"].map((repository) => (
                    <Button
                      key={repository}
                      size="sm"
                      variant={
                        repositories.includes(repository)
                          ? "secondary"
                          : "outline"
                      }
                      className="h-7 text-xs"
                      onClick={() =>
                        toggleFilter(repository, repositories, setRepositories)
                      }
                    >
                      {repositories.includes(repository) && (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      {repository}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <ul className="divide-y divide-border/60 border-t">
            {filteredActivities.map((activity) => (
              <li
                key={activity.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <UnreadDot />
                <Avatar activity={activity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{activity.subject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong className="font-medium text-foreground">
                      {activity.author}
                    </strong>{" "}
                    {activity.action} · {activity.repository}
                  </p>
                </div>
              </li>
            ))}
            {filteredActivities.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No unread activity matches both filters.
              </li>
            )}
          </ul>
        </OptionCard>

        <OptionCard
          number="07"
          title="Unread is a state, not a vague summary"
          description="Use one consistent vocabulary that distinguishes a new root item from new activity on an already-seen item."
        >
          <div className="space-y-3 p-4">
            <div className="rounded-lg border border-pink-500/25 bg-pink-500/[0.04] p-4">
              <div className="flex items-start gap-3">
                <GitPullRequest className="mt-0.5 h-4 w-4 shrink-0 text-pink-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Add local draft recovery
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sofia Chen requested changes · gitworkshop
                  </p>
                  <div className="mt-2">
                    <StatusLabel activity={activities[2]} unreadCount={2} />
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Update Android release notes
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    release-bot commented · gitworkshop
                  </p>
                  <div className="mt-2">
                    <StatusLabel activity={activities[0]} unreadCount={2} />
                  </div>
                </div>
              </div>
            </div>
            <p className="px-1 text-xs leading-5 text-muted-foreground">
              “New PR · 2 unread” says the root has never been seen and that
              more activity also needs attention. An existing root only says “2
              unread”, avoiding the ambiguous “2 new comments”.
            </p>
          </div>
        </OptionCard>

        <OptionCard
          number="08"
          title="A compact inbox control bar"
          description="One possible final composition: group mode and filters work together without turning the inbox header into a full search form."
        >
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Group:
              </span>
              <Badge variant="secondary">Root item</Badge>
              <span className="mx-1 h-4 border-l" />
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <UserRound className="mr-1.5 h-3.5 w-3.5" />
                Author
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <FolderGit2 className="mr-1.5 h-3.5 w-3.5" />
                Repository
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="gap-1 bg-pink-600 hover:bg-pink-600">
                <UserRound className="h-3 w-3" /> release-bot <span>×</span>
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <FolderGit2 className="h-3 w-3" /> gitworkshop <span>×</span>
              </Badge>
              <span className="self-center text-xs text-muted-foreground">
                35 unread activities
              </span>
            </div>
          </div>
        </OptionCard>
      </div>

      <section className="mt-10 rounded-xl border border-dashed p-5 md:p-6">
        <h2 className="text-lg font-semibold">
          Proposed direction to validate
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Retain <strong className="text-foreground">Root item</strong> as the
          default grouping. Add a compact grouping control for None and Author,
          then let the inbox combine Activity author and Repository filters.
          Replace “new comments” with explicit root and unread states:
          <strong className="text-foreground"> New PR · 2 unread</strong> or
          <strong className="text-foreground"> 2 unread activities</strong>.
        </p>
      </section>
    </div>
  );
}
