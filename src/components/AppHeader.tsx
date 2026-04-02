import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import { LoginArea } from "@/components/auth/LoginArea";
import { Settings, Send, Plus } from "lucide-react";
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
import { NavBarNotificationBadge } from "@/components/NavBarNotificationBadge";
import { CreateRepoDialog } from "@/components/CreateRepoDialog";

export function AppHeader() {
  const location = useLocation();
  const activeAccount = useActiveAccount();
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [outboxOpen, setOutboxOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center justify-between px-4 md:px-8">
        <Link to="/" className="group transition-opacity hover:opacity-80">
          <img src="/icons/icon.svg" alt="GitWorkshop" className="h-8 w-8" />
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

          {/* Notifications — only shown when logged in */}
          {activeAccount && <NavBarNotificationBadge />}

          {/* Outbox button */}
          <Popover open={outboxOpen} onOpenChange={setOutboxOpen}>
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
            <PopoverContent align="end" className="w-96 p-0">
              <OutboxPanel onClose={() => setOutboxOpen(false)} />
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
