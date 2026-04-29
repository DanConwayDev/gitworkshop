import { Link } from "react-router-dom";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { use$ } from "@/hooks/use$";
import { theme, toggleTheme } from "@/services/settings";

const gitCommit = __GIT_COMMIT__;
const commitDate = __COMMIT_DATE__;

const NAV_SECTIONS = [
  {
    heading: "Get started",
    links: [
      { label: "Install ngit", to: "/ngit" },
      { label: "Quick start", to: "/ngit", state: { expandQuickStart: true } },
      { label: "About", to: "/about" },
    ],
  },
  {
    heading: "Navigate",
    links: [
      { label: "Dashboard", to: "/" },
      { label: "Explore", to: "/explore" },
      { label: "Browse repos", to: "/search" },
    ],
  },
];

export function AppFooter() {
  const currentTheme = use$(theme);

  return (
    <footer className="mt-24 border-t border-border/40 bg-muted/30">
      <div className="container max-w-screen-xl mx-auto px-4 md:px-8">
        {/* Main footer content */}
        <div className="py-10 grid grid-cols-2 sm:grid-cols-[auto_1fr_auto] gap-8 sm:gap-12">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1 flex flex-col gap-2">
            <Link
              to="/"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity w-fit"
            >
              <img
                src="/icons/icon.svg"
                alt="GitWorkshop"
                className="h-6 w-6"
              />
              <span className="font-semibold text-sm">gitworkshop.dev</span>
            </Link>
            <p className="text-xs text-muted-foreground max-w-[18rem] leading-relaxed">
              Git collaboration, without the platform.
            </p>
          </div>

          {/* Nav columns */}
          <div className="col-span-2 sm:col-span-1 flex gap-12 sm:justify-center">
            {NAV_SECTIONS.map((section) => (
              <div key={section.heading} className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider mb-1">
                  {section.heading}
                </p>
                {section.links.map((link) => (
                  <Link
                    key={link.label}
                    to={link.to}
                    state={"state" in link ? link.state : undefined}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>

          {/* Theme toggle */}
          <div className="hidden sm:flex items-start justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {currentTheme === "light" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border/40 flex items-center justify-between h-10">
          <span className="text-xs text-muted-foreground/50">
            {commitDate}+{gitCommit.slice(0, 7)}
          </span>

          {/* Theme toggle on mobile */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground sm:hidden"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {currentTheme === "light" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </footer>
  );
}
