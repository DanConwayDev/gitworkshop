export function BetaBanner() {
  return (
    <div className="w-full bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm py-2 px-4 text-center">
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
    </div>
  );
}
