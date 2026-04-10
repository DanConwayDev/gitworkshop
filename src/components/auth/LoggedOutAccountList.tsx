/**
 * LoggedOutAccountList — shown in LoginArea when there are saved accounts
 * but none is currently active (e.g. after switching away or a partial logout).
 *
 * Lets the user quickly re-activate a saved account or add a new one.
 */

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
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import type { IAccount } from "applesauce-accounts";
import { useAccountManager } from "applesauce-react/hooks";
import { ChevronDown, UserIcon, UserPlus } from "lucide-react";

interface AccountRowProps {
  account: IAccount;
  onSelect: () => void;
}

function AccountRow({ account, onSelect }: AccountRowProps) {
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
          {displayName?.charAt(0) || <UserIcon className="w-4 h-4" />}
        </AvatarFallback>
      </Avatar>
      <p
        className={
          isPlaceholder
            ? "text-sm font-mono text-muted-foreground truncate flex-1"
            : "text-sm font-medium truncate flex-1"
        }
      >
        {displayName}
      </p>
    </DropdownMenuItem>
  );
}

interface LoggedOutAccountListProps {
  accounts: IAccount[];
  onAddAccountClick: () => void;
}

export function LoggedOutAccountList({
  accounts,
  onAddAccountClick,
}: LoggedOutAccountListProps) {
  const accountManager = useAccountManager();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground font-medium transition-all hover:bg-primary/90 animate-scale-in">
          <UserIcon className="w-4 h-4" />
          <span className="truncate">Log in</span>
          <ChevronDown className="w-4 h-4 opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 p-2 animate-scale-in">
        <div className="font-medium text-sm px-2 py-1.5 text-muted-foreground">
          Saved accounts
        </div>
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            onSelect={() => accountManager.setActive(account)}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
