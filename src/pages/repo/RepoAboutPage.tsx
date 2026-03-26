import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RepoAboutPanel } from "@/components/RepoAboutPanel";

export default function RepoAboutPage() {
  const { resolved } = useRepoContext();
  const repo = resolved?.repo;

  useSeoMeta({
    title: repo ? `${repo.name} - about - ngit` : "About - ngit",
    description: repo?.description ?? "Repository details",
  });

  if (!repo) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <div className="space-y-3 max-w-lg">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="pt-4 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="max-w-2xl space-y-6">
        <RepoAboutPanel repo={repo} variant="full" />
      </div>
    </div>
  );
}
