import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { GitBranch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  useSeoMeta({
    title: "ngit — Decentralized Git over Nostr",
    description:
      "Decentralized code collaboration over Nostr. Browse repositories, track issues, and contribute — without a central server.",
  });

  return (
    <div className="min-h-full flex items-center justify-center">
      <div className="text-center px-4 max-w-lg">
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-pink-500/10 to-pink-500/5 border border-pink-500/20">
            <GitBranch className="h-10 w-10 text-pink-500" />
          </div>
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          <span className="bg-gradient-to-r from-pink-600 via-pink-500 to-pink-600 dark:from-pink-400 dark:via-pink-400 dark:to-pink-400 bg-clip-text text-transparent">
            ngit
          </span>
        </h1>
        <p className="text-muted-foreground text-lg mb-8">
          Decentralized code collaboration over Nostr. Landing page coming soon.
        </p>
        <Button asChild>
          <Link to="/search">
            <Search className="h-4 w-4 mr-2" />
            Browse Repositories
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default Index;
