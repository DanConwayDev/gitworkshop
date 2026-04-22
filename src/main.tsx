import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import App from "./App.tsx";
import "./index.css";
import "@fontsource-variable/inter";

// Unregister any service worker left behind by the previous codebase and clear
// its caches. The tombstone SW (sw.js) handles the actual cleanup then removes
// itself, so subsequent loads are fully uncontrolled.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* ignore — browser may block in certain envs */
  });
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
