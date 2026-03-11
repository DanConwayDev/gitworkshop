// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { createHead, UnheadProvider } from "@unhead/react/client";
import { InferSeoMetaPlugin } from "@unhead/addons";
import { Suspense } from "react";
import {
  EventStoreProvider,
  AccountsProvider,
  ActionsProvider,
  FactoryProvider,
} from "applesauce-react/providers";
import { eventStore } from "@/services/nostr";
import { accounts } from "@/services/accounts";
import { runner, factory } from "@/services/actions";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppRouter from "./AppRouter";

const head = createHead({
  plugins: [InferSeoMetaPlugin()],
});

export function App() {
  return (
    <UnheadProvider head={head}>
      <EventStoreProvider eventStore={eventStore}>
        <AccountsProvider manager={accounts}>
          <ActionsProvider runner={runner}>
            <FactoryProvider factory={factory}>
              <TooltipProvider>
                <Toaster />
                <Suspense>
                  <AppRouter />
                </Suspense>
              </TooltipProvider>
            </FactoryProvider>
          </ActionsProvider>
        </AccountsProvider>
      </EventStoreProvider>
    </UnheadProvider>
  );
}

export default App;
