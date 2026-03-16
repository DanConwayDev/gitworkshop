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
        {/* NIP-34 repository routes - nested under shared layout */}
        <Route path="/:npub/:repoId" element={<RepoLayout />}>
          <Route index element={<RepoAboutPage />} />
          <Route path="issues" element={<RepoIssuesPage />} />
          <Route path="issues/:issueId" element={<IssuePage />} />
        </Route>
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
