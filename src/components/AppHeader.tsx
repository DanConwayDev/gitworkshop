import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import { LoginArea } from "@/components/auth/LoginArea";
import { Settings, Send, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// ---------------------------------------------------------------------------
// Inline search bar (wide screens)
// ---------------------------------------------------------------------------

function HeaderSearchBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Mirror the current URL query so the bar stays in sync when navigating
  const urlQuery =
    location.pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);

  // Keep local value in sync when the URL changes (e.g. browser back/forward)
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-56 xl:w-72">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search repositories…"
        className="h-8 pl-8 pr-3 text-sm bg-muted/50 border-border/50 focus-visible:ring-pink-500/30"
        aria-label="Search repositories"
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Collapsible search icon (narrow screens)
// ---------------------------------------------------------------------------

function HeaderSearchIcon() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  const urlQuery =
    location.pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (open) {
      // Small delay so the element is visible before focusing
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    setOpen(false);
  };

  if (open) {
    return (
      <form onSubmit={handleSubmit} className="flex items-center gap-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search…"
            className="h-8 w-44 pl-8 pr-3 text-sm bg-muted/50 border-border/50 focus-visible:ring-pink-500/30"
            aria-label="Search repositories"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Close search"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </form>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            location.pathname === "/search" && "bg-accent",
          )}
          aria-label="Search repositories"
          onClick={() => setOpen(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Search repositories</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// AppHeader
// ---------------------------------------------------------------------------

export function AppHeader() {
  const location = useLocation();
  const activeAccount = useActiveAccount();
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [outboxOpen, setOutboxOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center px-4 md:px-8">
        <Link
          to="/"
          className="group transition-opacity hover:opacity-80 shrink-0"
        >
          <img src="/icons/icon.svg" alt="GitWorkshop" className="h-8 w-8" />
        </Link>

        <div className="flex items-center gap-2 ml-auto">
          {/* Search bar — hidden on narrow screens */}
          <div className="hidden sm:flex">
            <HeaderSearchBar />
          </div>

          {/* Search icon — only on narrow screens */}
          <div className="sm:hidden">
            <HeaderSearchIcon />
          </div>

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
