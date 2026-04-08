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
import { useUserPath } from "@/hooks/useUserPath";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import type { IAccount } from "applesauce-accounts";
import {
  ExtensionAccount,
  NostrConnectAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import {
  use$,
  useAccountManager,
  useActiveAccount,
} from "applesauce-react/hooks";
import {
  ChevronDown,
  Key,
  LogOut,
  Puzzle,
  UserIcon,
  UserPlus,
  Wifi,
} from "lucide-react";
import { Link } from "react-router-dom";

function SignerTypeBadge({ account }: { account: IAccount }) {
  if (account instanceof ExtensionAccount)
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Puzzle className="w-3 h-3" />
        Extension
      </span>
    );
  if (account instanceof NostrConnectAccount)
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Wifi className="w-3 h-3" />
        Remote signer
      </span>
    );
  if (account instanceof PrivateKeyAccount)
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Key className="w-3 h-3" />
        Secret key
      </span>
    );
  return null;
}

interface AccountSwitcherProps {
  onAddAccountClick: () => void;
}

interface AccountItemProps {
  account: IAccount;
  isActive: boolean;
  onSelect: () => void;
}

function AccountItem({ account, isActive, onSelect }: AccountItemProps) {
  const { name: displayName, isPlaceholder } = useUserDisplayName(
    account.pubkey,
  );
  const profile = useProfile(account.pubkey);

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
      <div className="flex-1 min-w-0">
        <p
          className={
            isPlaceholder
              ? "text-sm font-mono text-muted-foreground truncate"
              : "text-sm font-medium truncate"
          }
        >
          {displayName}
        </p>
        <SignerTypeBadge account={account} />
      </div>
      {isActive && (
        <div className="w-2 h-2 rounded-full bg-primary shrink-0"></div>
      )}
    </DropdownMenuItem>
  );
}

export function AccountSwitcher({ onAddAccountClick }: AccountSwitcherProps) {
  const activeAccount = useActiveAccount();
  const accountManager = useAccountManager();
  const accounts = use$(accountManager.accounts$);
  const activeProfile = useProfile(activeAccount?.pubkey);
  const activeUserPath = useUserPath(activeAccount?.pubkey ?? "");
  const { name: displayName, isPlaceholder: activeIsPlaceholder } =
    useUserDisplayName(activeAccount?.pubkey ?? "");

  if (!activeAccount) return null;

  const otherAccounts = accounts.filter((acc) => acc.id !== activeAccount.id);

  const handleSetActive = (account: IAccount) => {
    accountManager.setActive(account);
  };

  const handleRemoveAccount = (account: IAccount) => {
    accountManager.removeAccount(account.id);
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
            <p
              className={
                activeIsPlaceholder
                  ? "font-mono text-sm text-muted-foreground truncate"
                  : "font-medium text-sm truncate"
              }
            >
              {displayName}
            </p>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 p-2 animate-scale-in">
        <DropdownMenuItem
          asChild
          className="flex items-center gap-2 cursor-pointer p-2 rounded-md"
        >
          <Link to={activeUserPath}>
            <Avatar className="w-8 h-8">
              <AvatarImage src={activeProfile?.picture} alt={displayName} />
              <AvatarFallback>{displayName.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p
                className={
                  activeIsPlaceholder
                    ? "text-sm font-mono text-muted-foreground truncate"
                    : "text-sm font-medium truncate"
                }
              >
                {displayName}
              </p>
              <SignerTypeBadge account={activeAccount} />
              <span className="text-xs text-muted-foreground">
                View profile
              </span>
            </div>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="font-medium text-sm px-2 py-1.5 text-muted-foreground">
          Switch Account
        </div>
        {otherAccounts.map((account) => (
          <AccountItem
            key={account.id}
            account={account}
            isActive={false}
            onSelect={() => handleSetActive(account)}
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
          onClick={() => handleRemoveAccount(activeAccount)}
          className="flex items-center gap-2 cursor-pointer p-2 rounded-md text-red-500"
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
