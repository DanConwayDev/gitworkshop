import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { nip19 } from "nostr-tools";

import { UserAvatar } from "@/components/UserAvatar";
import { useContactSearch } from "@/hooks/useContactSearch";
import { useProfile } from "@/hooks/useProfile";
import { useProfilesForPubkeys } from "@/hooks/useProfilesForPubkeys";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { cn } from "@/lib/utils";

export interface UserAutocompleteDropdownProps {
  query: string;
  isOpen: boolean;
  position: { top: number; left: number } | null;
  onSelectPubkey: (pubkey: string) => void;
  onClose: () => void;
  /** Element that should receive Arrow/Enter/Escape handling while open */
  keyboardTargetRef?: React.RefObject<HTMLElement | null>;
  /** Pubkeys to surface first in results (e.g. repo maintainers, thread participants) */
  priorityPubkeys?: string[];
  /** Pubkeys to hide from results (e.g. already selected users) */
  excludePubkeys?: string[];
  /** Stable id for the listbox, used by combobox inputs via aria-controls */
  listboxId?: string;
  /** Receives the active option id for aria-activedescendant on the owning input */
  onActiveDescendantChange?: (id: string | undefined) => void;
}

function getOptionId(listboxId: string, pubkey: string): string {
  return `${listboxId}-option-${pubkey}`;
}

export function UserAutocompleteDropdown({
  query,
  isOpen,
  position,
  onSelectPubkey,
  onClose,
  keyboardTargetRef,
  priorityPubkeys = [],
  excludePubkeys = [],
  listboxId: providedListboxId,
  onActiveDescendantChange,
}: UserAutocompleteDropdownProps) {
  const generatedListboxId = useId();
  const listboxId = providedListboxId ?? generatedListboxId;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const contacts = useContactSearch(isOpen ? query : "", priorityPubkeys);
  const excludeSet = useMemo(() => new Set(excludePubkeys), [excludePubkeys]);
  const filteredContacts = useMemo(
    () => contacts.filter((contact) => !excludeSet.has(contact.pubkey)),
    [contacts, excludeSet],
  );

  // Fetch profiles for the pubkeys currently visible in the dropdown.
  // This is intentionally targeted — only the rendered items, not the full
  // follow list. useProfilesForPubkeys fires a single batched REQ to the
  // lookup relays and updates UserAutocompleteItem reactively as profiles arrive.
  const renderedPubkeys = useMemo(
    () => filteredContacts.map((c) => c.pubkey),
    [filteredContacts],
  );
  useProfilesForPubkeys(renderedPubkeys);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    setSelectedIndex((index) =>
      filteredContacts.length === 0
        ? 0
        : Math.min(index, filteredContacts.length - 1),
    );
  }, [filteredContacts.length]);

  const selectedPubkey = filteredContacts[selectedIndex]?.pubkey;
  const activeDescendantId =
    isOpen && selectedPubkey
      ? getOptionId(listboxId, selectedPubkey)
      : undefined;

  useEffect(() => {
    onActiveDescendantChange?.(activeDescendantId);
  }, [activeDescendantId, onActiveDescendantChange]);

  // Dismiss on any scroll outside the dropdown list so the fixed dropdown
  // doesn't float away from its anchor. Scroll events originating inside the
  // list itself (from keyboard navigation scrollIntoView) are ignored.
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("scroll", handleScroll, { capture: true });
  }, [isOpen, onClose]);

  const selectContact = useCallback(
    (pubkey: string) => {
      onSelectPubkey(pubkey);
      onClose();
    },
    [onSelectPubkey, onClose],
  );

  // Handle keyboard navigation within the dropdown
  useEffect(() => {
    if (!isOpen || filteredContacts.length === 0) return;

    const target = keyboardTargetRef?.current;
    if (!target) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredContacts.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredContacts.length - 1,
          );
          break;
        case "Enter":
        case "Tab": {
          e.preventDefault();
          const selected = filteredContacts[selectedIndex];
          if (selected) selectContact(selected.pubkey);
          break;
        }
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    target.addEventListener("keydown", handleKeyDown);
    return () => target.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    filteredContacts,
    selectedIndex,
    keyboardTargetRef,
    selectContact,
    onClose,
  ]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll(
        "[data-user-autocomplete-item]",
      );
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen || !position || filteredContacts.length === 0) {
    return null;
  }

  // Render via portal so the dropdown escapes any overflow:hidden or
  // CSS-transform ancestor (e.g. Radix Dialog), while fixed coordinates
  // keep it anchored to the correct viewport position.
  return createPortal(
    <div
      className="fixed z-[100] w-[280px] rounded-xl border border-border bg-popover shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
      style={{ top: position.top, left: position.left }}
    >
      <div
        id={listboxId}
        ref={listRef}
        role="listbox"
        className="max-h-[240px] overflow-y-auto py-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-border/80"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "hsl(var(--border)) transparent",
        }}
      >
        {filteredContacts.map(({ pubkey }, index) => (
          <UserAutocompleteItem
            key={pubkey}
            id={getOptionId(listboxId, pubkey)}
            pubkey={pubkey}
            isSelected={index === selectedIndex}
            onClick={() => selectContact(pubkey)}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function UserAutocompleteItem({
  id,
  pubkey,
  isSelected,
  onClick,
}: {
  id: string;
  pubkey: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  // useUserDisplayName subscribes reactively and updates when kind:0 lands.
  const { name: displayName, isPlaceholder } = useUserDisplayName(pubkey);
  const profile = useProfile(pubkey);
  const nip05 = profile?.nip05;
  const npub = nip19.npubEncode(pubkey);
  const identifier = nip05 ?? `${npub.slice(0, 12)}…`;

  return (
    <button
      id={id}
      data-user-autocomplete-item
      type="button"
      role="option"
      aria-selected={isSelected}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary/60",
      )}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
    >
      <UserAvatar pubkey={pubkey} size="md" className="shrink-0" />

      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "font-semibold text-sm truncate font-mono",
            isPlaceholder && "text-muted-foreground",
          )}
        >
          {displayName}
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono">
          {identifier}
        </div>
      </div>
    </button>
  );
}
