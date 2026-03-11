// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useProfile } from "@/hooks/useProfile";
import { genUserName } from "@/lib/genUserName";
import type { IAccount } from "applesauce-accounts";
import {
  use$,
  useAccountManager,
  useActiveAccount,
} from "applesauce-react/hooks";
import { ChevronDown, LogOut, UserIcon, UserPlus } from "lucide-react";

interface AccountSwitcherProps {
  onAddAccountClick: () => void;
}

interface AccountItemProps {
  account: IAccount;
  isActive: boolean;
  onSelect: () => void;
}

function AccountItem({ account, isActive, onSelect }: AccountItemProps) {
  const profile = useProfile(account.pubkey);
  const displayName = profile?.name ?? genUserName(account.pubkey);

  return (
    <DropdownMenuItem
      onClick={onSelect}
      className="flex items-center gap-2 cursor-pointer p-2 rounded-md"
    >
      <Avatar className="w-8 h-8">
        <AvatarImage src={profile?.picture} alt={displayName} />
        <AvatarFallback>
          {displayName?.charAt(0) || <UserIcon />}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 truncate">
        <p className="text-sm font-medium">{displayName}</p>
      </div>
      {isActive && <div className="w-2 h-2 rounded-full bg-primary"></div>}
    </DropdownMenuItem>
  );
}

export function AccountSwitcher({ onAddAccountClick }: AccountSwitcherProps) {
  const activeAccount = useActiveAccount();
  const accountManager = useAccountManager();
  const accounts = use$(accountManager.accounts$);
  const activeProfile = useProfile(activeAccount?.pubkey);

  if (!activeAccount) return null;

  const otherAccounts = accounts.filter(
    (acc) => acc.pubkey !== activeAccount.pubkey,
  );
  const displayName = activeProfile?.name ?? genUserName(activeAccount.pubkey);

  const handleSetActive = (pubkey: string) => {
    accountManager.setActive(pubkey);
  };

  const handleRemoveAccount = (pubkey: string) => {
    accountManager.removeAccount(pubkey);
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-3 p-3 rounded-full hover:bg-accent transition-all w-full text-foreground">
          <Avatar className="w-10 h-10">
            <AvatarImage src={activeProfile?.picture} alt={displayName} />
            <AvatarFallback>{displayName.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 text-left hidden md:block truncate">
            <p className="font-medium text-sm truncate">{displayName}</p>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 p-2 animate-scale-in">
        <div className="font-medium text-sm px-2 py-1.5">Switch Account</div>
        {otherAccounts.map((account) => (
          <AccountItem
            key={account.pubkey}
            account={account}
            isActive={false}
            onSelect={() => handleSetActive(account.pubkey)}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onAddAccountClick}
          className="flex items-center gap-2 cursor-pointer p-2 rounded-md"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add another account</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleRemoveAccount(activeAccount.pubkey)}
          className="flex items-center gap-2 cursor-pointer p-2 rounded-md text-red-500"
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
