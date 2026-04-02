import { Link } from "react-router-dom";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { use$ } from "@/hooks/use$";
import { theme, toggleTheme } from "@/services/settings";

const gitCommit = __GIT_COMMIT__;
const commitDate = __COMMIT_DATE__;

export function AppFooter() {
  const currentTheme = use$(theme);

  return (
    <footer className="mt-24 border-t border-border/40 bg-muted/30">
      <div className="container max-w-screen-xl mx-auto px-4 md:px-8">
        <div className="flex items-center h-12">
          {/* Left spacer — pushes centre content to true centre */}
          <div className="flex-1" />

          {/* Logo + name + version */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link
              to="/"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <img
                src="/icons/icon-32x32.png"
                alt="GitWorkshop"
                className="h-4 w-4 rounded"
              />
              <span className="font-medium">GitWorkshop</span>
            </Link>
            <span className="opacity-50">
              {commitDate}+{gitCommit.slice(0, 7)}
            </span>
          </div>

          {/* Right spacer — keeps centre content centred */}
          <div className="flex-1" />

          {/* Theme toggle — sits at the far right */}
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
    </footer>
  );
}
