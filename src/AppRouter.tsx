import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { nip19 } from "nostr-tools";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppHeader } from "./components/AppHeader";
import { AppFooter } from "./components/AppFooter";
import { BetaBanner } from "./components/BetaBanner";

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

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <BetaBanner />
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/explore" element={<LandingPage />} />
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
                ws:// is URL-encoded. e.g. /relay/relay.ngit.dev
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
