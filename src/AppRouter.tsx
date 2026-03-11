import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppHeader } from "./components/AppHeader";

import RepositoriesPage from "./pages/RepositoriesPage";
import RepoPage from "./pages/RepoPage";
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
        {/* NIP-34 issue tracker routes - most specific first */}
        <Route path="/:npub/:repoId/:issueId" element={<IssuePage />} />
        <Route path="/:npub/:repoId" element={<RepoPage />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
