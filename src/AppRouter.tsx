import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { nip19 } from "nostr-tools";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppHeader } from "./components/AppHeader";
import { AppFooter } from "./components/AppFooter";

import Index from "./pages/Index";
import { LandingPage } from "./pages/LandingPage";
import RepositoriesPage from "./pages/RepositoriesPage";
import NotificationsPage from "./pages/NotificationsPage";
import RelayPage from "./pages/RelayPage";
import RepoLayout from "./pages/repo/RepoLayout";
import Settings from "./pages/Settings";
import OutboxPage from "./pages/OutboxPage";
import { NIP19Page } from "./pages/NIP19Page";
import NgitPage from "./pages/NgitPage";
import About from "./pages/About";
import OgImagePreview from "./pages/OgImagePreview";
import NotFound from "./pages/NotFound";
import { useRepoPath } from "./hooks/useRepoPath";
import { REPO_KIND } from "./lib/nip34";
import { getGitWorkshopPath } from "./lib/gitworkshopUrl";

/**
 * Handles public GitWorkshop links in native builds. This stays inside the
 * BrowserRouter so both Android App Links and in-WebView clicks can use React
 * Router without affecting ordinary web-browser navigation.
 */
function NativeGitWorkshopLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const navigateToGitWorkshopUrl = (url: string) => {
      const path = getGitWorkshopPath(url);
      if (path) navigate(path);
    };

    const getInternalAnchorPath = (
      anchor: HTMLAnchorElement,
    ): string | null => {
      const gitWorkshopPath = getGitWorkshopPath(anchor.href);
      if (gitWorkshopPath) return gitWorkshopPath;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(href)) {
        return null;
      }

      const relativeUrl = new URL(href, window.location.href);
      return `${relativeUrl.pathname}${relativeUrl.search}${relativeUrl.hash}`;
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.rel.split(/\s+/).includes("external")
      ) {
        return;
      }

      const path = getInternalAnchorPath(anchor);
      if (!path) return;

      event.preventDefault();
      navigate(path);
    };

    document.addEventListener("click", handleDocumentClick);

    let disposed = false;
    let appUrlListener: Awaited<ReturnType<typeof App.addListener>> | undefined;

    void App.addListener("appUrlOpen", ({ url }) => {
      if (!disposed) navigateToGitWorkshopUrl(url);
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
      } else {
        appUrlListener = listener;
      }
    });

    // App Links delivered while Android cold-starts the activity are available
    // here even if appUrlOpen fired before React completed mounting.
    void App.getLaunchUrl().then((launchUrl) => {
      if (!disposed && launchUrl) navigateToGitWorkshopUrl(launchUrl.url);
    });

    return () => {
      disposed = true;
      document.removeEventListener("click", handleDocumentClick);
      if (appUrlListener) void appUrlListener.remove();
    };
  }, [navigate]);

  return null;
}

/**
 * Maps Android's hardware Back button onto the WebView history managed by
 * BrowserRouter. Open web dialogs receive their existing Escape behavior before
 * route history is considered.
 */
function NativeAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;

    let disposed = false;
    let backButtonListener:
      | Awaited<ReturnType<typeof App.addListener>>
      | undefined;

    void App.addListener("backButton", ({ canGoBack }) => {
      if (disposed) return;

      const openDialog = document.querySelector<HTMLElement>(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      );
      if (openDialog) {
        openDialog.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }

      if (canGoBack) {
        navigate(-1);
        return;
      }

      if (locationRef.current.pathname !== "/") {
        // A cold-start deep link can be the first WebView entry. Returning to
        // the app root is safer than closing the app from that content page.
        navigate("/", { replace: true });
        return;
      }

      void App.exitApp();
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
      } else {
        backButtonListener = listener;
      }
    });

    return () => {
      disposed = true;
      if (backButtonListener) void backButtonListener.remove();
    };
  }, [navigate]);

  return null;
}

// ---------------------------------------------------------------------------
// naddr + sub-path redirect
//
// Handles paths like /naddr1.../<subpath> where naddr1 encodes a repo
// coordinate. Decodes the naddr, resolves the canonical repo path via
// useRepoPath (NIP-05 preferred), then navigates to /<repoPath>/<subpath>.
// ---------------------------------------------------------------------------

function NaddrSubPathRedirectInner({
  pubkey,
  repoId,
  relays,
  subPath,
  search,
  hash,
}: {
  pubkey: string;
  repoId: string;
  relays: string[];
  subPath: string;
  search: string;
  hash: string;
}) {
  const repoPath = useRepoPath(pubkey, repoId, relays);
  const suffix = subPath ? `/${subPath}` : "";
  return <Navigate to={`${repoPath}${suffix}${search}${hash}`} replace />;
}

function NaddrSubPathRedirect({
  naddr,
  subPath,
  search,
  hash,
}: {
  naddr: string;
  subPath: string;
  search: string;
  hash: string;
}) {
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type === "naddr" && decoded.data.kind === REPO_KIND) {
      return (
        <NaddrSubPathRedirectInner
          pubkey={decoded.data.pubkey}
          repoId={decoded.data.identifier}
          relays={decoded.data.relays ?? []}
          subPath={subPath}
          search={search}
          hash={hash}
        />
      );
    }
  } catch {
    // fall through
  }
  return <NotFound />;
}

// ---------------------------------------------------------------------------
// Legacy redirect handler
//
// Mirrors the redirects from gitworkshop's [...rest]/+layout.ts:
//   /r/<rest>              → /<rest>          (old repo prefix)
//   /p/<rest>              → /<rest>          (old pubkey prefix)
//   /e/<rest>              → /<rest>          (old event prefix)
//   /repo/<identifier>     → /search?q=<identifier>
//   /repos                 → /               (repo listing)
//   /search/<identifier>   → /search?q=<identifier>
//   /install[/]            → /ngit
//   /quick-start[/]        → /ngit
//   /naddr1.../<subpath>   → /<repoPath>/<subpath>  (naddr with sub-path)
//   /<any>/.../proposals/  → /<any>/.../prs/  (old PR tab name)
// ---------------------------------------------------------------------------

function LegacyRedirect() {
  const location = useLocation();
  // Strip the leading slash to get the raw path
  const raw = location.pathname.slice(1);

  // /r/<rest>, /p/<rest>, /e/<rest> — strip the single-letter prefix
  for (const prefix of ["r/", "p/", "e/"]) {
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      return (
        <Navigate to={`/${rest}${location.search}${location.hash}`} replace />
      );
    }
  }

  // /repo/<identifier> — redirect to /search?q=<identifier>
  if (raw.startsWith("repo/")) {
    const identifier = raw.slice(5);
    if (identifier) {
      const params = new URLSearchParams(location.search);
      params.set("q", identifier);
      return (
        <Navigate to={`/search?${params.toString()}${location.hash}`} replace />
      );
    }
  }

  // /repos — redirect to search (repo listing)
  if (raw === "repos" || raw.startsWith("repos/")) {
    return (
      <Navigate to={`/search${location.search}${location.hash}`} replace />
    );
  }

  // /search/<identifier> — redirect to /search?q=<identifier>
  if (raw.startsWith("search/")) {
    const identifier = raw.slice("search/".length);
    if (identifier) {
      const params = new URLSearchParams(location.search);
      params.set("q", identifier);
      return (
        <Navigate to={`/search?${params.toString()}${location.hash}`} replace />
      );
    }
  }

  // /install[/] and /quick-start[/] — redirect to /ngit
  if (
    raw === "install" ||
    raw === "install/" ||
    raw === "quick-start" ||
    raw === "quick-start/"
  ) {
    return <Navigate to="/ngit" replace />;
  }

  // /naddr1.../<subpath> — naddr with a sub-path (e.g. /prs/note1..., /issues)
  // The bare /naddr1... case is already handled by the /:nip19 route above.
  if (raw.startsWith("naddr1")) {
    const slashIdx = raw.indexOf("/");
    if (slashIdx !== -1) {
      const naddr = raw.slice(0, slashIdx);
      // Normalise /proposals/ → /prs/ in the sub-path before redirecting
      const subPath = raw
        .slice(slashIdx + 1)
        .replace(/^proposals\//, "prs/")
        .replace(/\/proposals\//g, "/prs/");
      return (
        <NaddrSubPathRedirect
          naddr={naddr}
          subPath={subPath}
          search={location.search}
          hash={location.hash}
        />
      );
    }
  }

  // /proposals/ anywhere in the path (bare npub/nip05 repo routes using old name)
  if (raw.includes("/proposals/")) {
    const fixed = raw.replace(/\/proposals\//g, "/prs/");
    return (
      <Navigate to={`/${fixed}${location.search}${location.hash}`} replace />
    );
  }

  // /pr/ anywhere in the path (gitworkshop used singular /pr/ for individual PRs)
  if (raw.includes("/pr/")) {
    const fixed = raw.replace(/\/pr\//g, "/prs/");
    return (
      <Navigate to={`/${fixed}${location.search}${location.hash}`} replace />
    );
  }

  // Not a legacy path — fall through to RepoLayout
  return <RepoLayout />;
}

function AppRouter() {
  return (
    <BrowserRouter>
      <NativeGitWorkshopLinks />
      <NativeAndroidBackButton />
      <ScrollToTop />
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/search" element={<RepositoriesPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/outbox" element={<OutboxPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/ngit" element={<NgitPage />} />
            {/* Backwards-compat redirects — must be before /:nip19 */}
            <Route path="/install" element={<Navigate to="/ngit" replace />} />
            <Route
              path="/quick-start"
              element={
                <Navigate
                  to="/ngit"
                  state={{ expandQuickStart: true }}
                  replace
                />
              }
            />
            <Route path="/about" element={<About />} />
            <Route path="/og-preview" element={<OgImagePreview />} />
            {/* /relay/:relaySegment — browse repos on a specific relay.
                 The segment uses the same format as relay hints: wss:// is stripped,
                 ws:// uses a slash-free encoded scheme. e.g. /relay/relay.ngit.dev
                 Must be declared before /:nip19 to avoid being swallowed. */}
            <Route path="/relay/:relaySegment" element={<RelayPage />} />
            {/* NIP-19 route for single-segment bech32 identifiers:
                npub1…, nprofile1…, note1…, nevent1…, naddr1… */}
            <Route path="/:nip19" element={<NIP19Page />} />
            {/* Multi-segment paths: legacy redirects are checked first, then
                repo routes (/:npub/:repoId, /:nip05/:repoId, etc.) */}
            <Route path="/*" element={<LegacyRedirect />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <AppFooter />
      </div>
    </BrowserRouter>
  );
}
export default AppRouter;
