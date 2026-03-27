import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import { LoginArea } from "@/components/auth/LoginArea";
import { GitBranch, Settings, Send, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { OutboxPanel, OutboxPendingBadge } from "@/components/OutboxPanel";
import { CreateRepoDialog } from "@/components/CreateRepoDialog";

export function AppHeader() {
  const location = useLocation();
  const activeAccount = useActiveAccount();
  const [createRepoOpen, setCreateRepoOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center justify-between px-4 md:px-8">
        <Link to="/" className="flex items-center gap-2.5 group transition-all">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg blur-sm opacity-50 group-hover:opacity-75 transition-opacity" />
            <div className="relative bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg p-1.5">
              <GitBranch className="h-4 w-4 text-white" />
            </div>
          </div>
          <span className="font-semibold text-lg tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            ngit
          </span>
          <span className="text-xs text-muted-foreground font-medium bg-muted px-1.5 py-0.5 rounded-md">
            issues
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {/* Create repo button — only shown when logged in */}
          {activeAccount && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Create repository"
                  onClick={() => setCreateRepoOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New repository</TooltipContent>
            </Tooltip>
          )}

          {/* Outbox button */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 relative"
                aria-label="Outbox"
              >
                <Send className="h-4 w-4" />
                <span className="absolute -top-0.5 -right-0.5">
                  <OutboxPendingBadge />
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-96 p-0 max-h-[480px] overflow-hidden flex flex-col"
            >
              <OutboxPanel />
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            asChild
            className={cn(
              "h-8 w-8",
              location.pathname === "/settings" && "bg-accent",
            )}
          >
            <Link to="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <LoginArea className="max-w-60" />
        </div>
      </div>

      <CreateRepoDialog
        isOpen={createRepoOpen}
        onClose={() => setCreateRepoOpen(false)}
      />
    </header>
  );
}
