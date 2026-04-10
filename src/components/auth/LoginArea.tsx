// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import { Button } from "@/components/ui/button.tsx";
import {
  use$,
  useAccountManager,
  useActiveAccount,
} from "applesauce-react/hooks";
import { AccountSwitcher } from "./AccountSwitcher";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { cn } from "@/lib/utils";
import { LoggedOutAccountList } from "./LoggedOutAccountList";

export interface LoginAreaProps {
  className?: string;
}

export function LoginArea({ className }: LoginAreaProps) {
  const activeAccount = useActiveAccount();
  const accountManager = useAccountManager();
  const accounts = use$(accountManager.accounts$);
  const { openAuthModal } = useAuthModal();

  return (
    <div className={cn("inline-flex items-center justify-center", className)}>
      {activeAccount ? (
        <AccountSwitcher onAddAccountClick={() => openAuthModal("sign-in")} />
      ) : accounts && accounts.length > 0 ? (
        <LoggedOutAccountList
          accounts={accounts}
          onAddAccountClick={() => openAuthModal("sign-in")}
        />
      ) : (
        <div className="flex gap-3 justify-center">
          <Button
            onClick={() => openAuthModal("sign-in")}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground w-full font-medium transition-all hover:bg-primary/90 animate-scale-in"
          >
            <span className="truncate">Log in</span>
          </Button>
          <Button
            onClick={() => openAuthModal("create-account")}
            variant="outline"
            className="flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all"
          >
            <span>Sign up</span>
          </Button>
        </div>
      )}
    </div>
  );
}
