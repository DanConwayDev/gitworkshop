import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppHeader } from "./components/AppHeader";
import { AppFooter } from "./components/AppFooter";

import RepositoriesPage from "./pages/RepositoriesPage";
import NotificationsPage from "./pages/NotificationsPage";
import RelayPage from "./pages/RelayPage";
import RepoLayout from "./pages/repo/RepoLayout";
import Settings from "./pages/Settings";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="flex flex-col min-h-screen">
        <AppHeader />
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<RepositoriesPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            {/* /relay/:relaySegment — browse repos on a specific relay.
                The segment uses the same format as relay hints: wss:// is stripped,
                ws:// is URL-encoded. e.g. /relay/relay.ngit.dev
                Must be declared before /:nip19 to avoid being swallowed. */}
            <Route path="/relay/:relaySegment" element={<RelayPage />} />
            {/* NIP-19 route for single-segment bech32 identifiers:
                npub1…, nprofile1…, note1…, nevent1…, naddr1… */}
            <Route path="/:nip19" element={<NIP19Page />} />
            {/* NIP-34 repository routes — splat captures all multi-segment paths:
                  /:npub/:repoId
                  /:npub/:relayHint/:repoId
                  /:nip05/:repoId
                  /:nip05/:relayHint/:repoId
                RepoLayout parses the splat and renders an error if it doesn't match. */}
            <Route path="/*" element={<RepoLayout />} />
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
