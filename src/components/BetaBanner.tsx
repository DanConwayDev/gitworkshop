import { X } from "lucide-react";
import { use$ } from "@/hooks/use$";
import { betaBannerDismissed } from "@/services/settings";

export function BetaBanner() {
  const dismissed = use$(betaBannerDismissed);

  if (dismissed) return null;

  return (
    <div className="w-full bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm py-2 px-4 flex items-center justify-center gap-2 relative">
      <span className="text-center">
        You're on the beta. Need the{" "}
        <a
          href="https://v2--gitworkshop.netlify.app"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 font-medium hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
        >
          old version
        </a>
        ?
      </span>
      <button
        type="button"
        onClick={() => betaBannerDismissed.next(true)}
        aria-label="Dismiss beta banner"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-amber-500/20 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
