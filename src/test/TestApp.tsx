import { useMemo } from "react";
import { createHead, UnheadProvider } from "@unhead/react/client";
import { BrowserRouter } from "react-router-dom";
import {
  EventStoreProvider,
  AccountsProvider,
  ActionsProvider,
  FactoryProvider,
} from "applesauce-react/providers";
import { EventStore, EventFactory } from "applesauce-core";
import { AccountManager, Accounts } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";

interface TestAppProps {
  children: React.ReactNode;
}

export function TestApp({ children }: TestAppProps) {
  const head = createHead();

  // Create isolated test instances
  const eventStore = useMemo(() => new EventStore(), []);
  const accountManager = useMemo(() => {
    const manager = new AccountManager();
    Accounts.registerCommonAccountTypes(manager);
    return manager;
  }, []);

  const factory = useMemo(
    () =>
      new EventFactory({
        // @ts-expect-error - Signer type compatibility
        signer: () => {
          const account = accountManager.getActive();
          if (!account) throw new Error("No active account");
          return account.signer;
        },
      }),
    [accountManager],
  );

  const runner = useMemo(
    () =>
      new ActionRunner(eventStore, factory, async (event) => {
        eventStore.add(event);
      }),
    [eventStore, factory],
  );

  return (
    <UnheadProvider head={head}>
      <EventStoreProvider eventStore={eventStore}>
        <AccountsProvider manager={accountManager}>
          <ActionsProvider runner={runner}>
            <FactoryProvider factory={factory}>
              <BrowserRouter>{children}</BrowserRouter>
            </FactoryProvider>
          </ActionsProvider>
        </AccountsProvider>
      </EventStoreProvider>
    </UnheadProvider>
  );
}

export default TestApp;
