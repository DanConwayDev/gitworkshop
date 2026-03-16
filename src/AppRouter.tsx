import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppHeader } from "./components/AppHeader";

import RepositoriesPage from "./pages/RepositoriesPage";
import RepoLayout from "./pages/repo/RepoLayout";
import RepoAboutPage from "./pages/repo/RepoAboutPage";
import RepoIssuesPage from "./pages/repo/RepoIssuesPage";
import IssuePage from "./pages/IssuePage";
import Settings from "./pages/Settings";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AppHeader />
      <Routes>
        <Route path="/" element={<RepositoriesPage />} />
        <Route path="/settings" element={<Settings />} />
        {/* NIP-19 route for single-segment bech32 identifiers:
            npub1…, nprofile1…, note1…, nevent1…, naddr1… */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* NIP-34 repository routes — splat captures all multi-segment paths:
              /:npub/:repoId
              /:npub/:relayHint/:repoId
              /:nip05/:repoId
              /:nip05/:relayHint/:repoId
            RepoLayout parses the splat and renders an error if it doesn't match. */}
        <Route path="/*" element={<RepoLayout />}>
          <Route index element={<RepoAboutPage />} />
          <Route path="issues" element={<RepoIssuesPage />} />
          <Route path="issues/:issueId" element={<IssuePage />} />
        </Route>
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
