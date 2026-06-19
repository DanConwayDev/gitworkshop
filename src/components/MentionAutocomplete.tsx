import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { nip19 } from "nostr-tools";
import { UserAvatar } from "@/components/UserAvatar";
import { useContactSearch } from "@/hooks/useContactSearch";
import { useProfile } from "@/hooks/useProfile";
import { useProfilesForPubkeys } from "@/hooks/useProfilesForPubkeys";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MentionAutocompleteProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  onInsertMention: (params: {
    start: number;
    end: number;
    replacement: string;
  }) => void;
  /** Pubkeys to surface first in results (e.g. repo maintainers, thread participants) */
  priorityPubkeys?: string[];
}

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
}

// ---------------------------------------------------------------------------
// Mirror-div technique: compute caret pixel coordinates inside a textarea.
// Adapted from /persistent/clones/ditto/src/components/MentionAutocomplete.tsx
// ---------------------------------------------------------------------------

/** CSS properties that affect text layout and must be copied to the mirror element. */
const MIRROR_PROPS = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "MozTabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
] as const;

/**
 * Returns the pixel {top, left} of a character position within a textarea,
 * relative to the textarea element's top-left corner.
 */
function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const mirror = document.createElement("div");
  mirror.id = "mention-mirror";

  const style = window.getComputedStyle(textarea);

  // Copy all layout-affecting styles
  for (const prop of MIRROR_PROPS) {
    mirror.style[prop as string] = style.getPropertyValue(
      prop.replace(/([A-Z])/g, "-$1").toLowerCase(),
    );
  }

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";

  document.body.appendChild(mirror);

  // Set the text up to the caret position
  mirror.textContent = textarea.value.substring(0, position);

  // Add a span at the caret position to measure
  const marker = document.createElement("span");
  marker.textContent = "\u200b"; // zero-width space
  mirror.appendChild(marker);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();

  const coords = {
    top: markerRect.top - mirrorRect.top - textarea.scrollTop,
    left: markerRect.left - mirrorRect.left - textarea.scrollLeft,
  };

  document.body.removeChild(mirror);
  return coords;
}

// ---------------------------------------------------------------------------
// MentionAutocomplete component
// ---------------------------------------------------------------------------

/**
 * Detects `@query` at the cursor position in a textarea and shows
 * a contact autocomplete dropdown. On selection, replaces `@query`
 * with `nostr:npub1...` in the content.
 */
export function MentionAutocomplete({
  textareaRef,
  content,
  onInsertMention,
  priorityPubkeys = [],
}: MentionAutocompleteProps) {
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Detect @mention query at cursor.
  const detectMention = useCallback(
    (text?: string, cursorPos?: number) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursor = cursorPos ?? textarea.selectionStart;
      const value = text ?? textarea.value;

      // Walk back from cursor to find an unescaped @ that starts a mention
      let atPos = -1;
      for (let i = cursor - 1; i >= 0; i--) {
        const ch = value[i];
        // Stop at whitespace or newline — no match
        if (ch === " " || ch === "\n" || ch === "\t") break;
        if (ch === "@") {
          // Must be at start of text or preceded by whitespace
          if (i === 0 || /\s/.test(value[i - 1])) {
            atPos = i;
          }
          break;
        }
      }

      if (atPos === -1) {
        setIsOpen(false);
        setMentionQuery("");
        setMentionStart(-1);
        return;
      }

      const query = value.slice(atPos + 1, cursor);

      // Show for empty query (top contacts); dismiss for very long queries
      if (query.length > 50) {
        setIsOpen(false);
        setMentionQuery("");
        setMentionStart(-1);
        return;
      }

      setMentionQuery(query);
      setMentionStart(atPos);
      setIsOpen(true);

      // Position the dropdown below the @ character.
      // Use fixed (viewport) coordinates so the dropdown escapes any
      // overflow:hidden ancestor (e.g. the composer border wrapper).
      const coords = getCaretCoordinates(textarea, atPos);
      const lineHeight =
        parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
      const rect = textarea.getBoundingClientRect();
      setDropdownPos({
        top: rect.top + coords.top + lineHeight + 4,
        left: Math.max(
          0,
          Math.min(rect.left + coords.left, window.innerWidth - 280),
        ),
      });
    },
    [textareaRef],
  );

  // Listen for input/cursor changes on the textarea element.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleInput = () => {
      detectMention(textarea.value, textarea.selectionStart);
    };
    const handleClick = () => detectMention();
    const handleKeyUp = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        detectMention();
      }
    };

    textarea.addEventListener("input", handleInput);
    textarea.addEventListener("click", handleClick);
    textarea.addEventListener("keyup", handleKeyUp);

    return () => {
      textarea.removeEventListener("input", handleInput);
      textarea.removeEventListener("click", handleClick);
      textarea.removeEventListener("keyup", handleKeyUp);
    };
    // content in deps so we re-attach if textarea element is remounted
  }, [textareaRef, detectMention, content]);

  // Re-detect when content changes (covers external mutations)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    detectMention(content, textarea.selectionStart);
  }, [content, detectMention, textareaRef]);

  const selectContact = useCallback(
    (pubkey: string) => {
      const npub = nip19.npubEncode(pubkey);
      const replacement = `nostr:${npub} `;
      const cursor =
        textareaRef.current?.selectionStart ??
        mentionStart + mentionQuery.length + 1;

      onInsertMention({
        start: mentionStart,
        end: cursor,
        replacement,
      });

      setIsOpen(false);
      setMentionQuery("");
      setMentionStart(-1);
    },
    [mentionStart, mentionQuery, textareaRef, onInsertMention],
  );

  return (
    <UserAutocompleteDropdown
      query={mentionQuery}
      isOpen={isOpen}
      position={dropdownPos}
      onSelectPubkey={selectContact}
      onClose={() => setIsOpen(false)}
      keyboardTargetRef={textareaRef}
      priorityPubkeys={priorityPubkeys}
    />
  );
}

// ---------------------------------------------------------------------------
// UserAutocompleteDropdown
// ---------------------------------------------------------------------------

export function UserAutocompleteDropdown({
  query,
  isOpen,
  position,
  onSelectPubkey,
  onClose,
  keyboardTargetRef,
  priorityPubkeys = [],
  excludePubkeys = [],
}: UserAutocompleteDropdownProps) {
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
        case "Tab":
          e.preventDefault();
          selectContact(filteredContacts[selectedIndex].pubkey);
          break;
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
        ref={listRef}
        className="max-h-[240px] overflow-y-auto py-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-border/80"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "hsl(var(--border)) transparent",
        }}
      >
        {filteredContacts.map(({ pubkey }, index) => (
          <UserAutocompleteItem
            key={pubkey}
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

// ---------------------------------------------------------------------------
// UserAutocompleteItem
// ---------------------------------------------------------------------------

function UserAutocompleteItem({
  pubkey,
  isSelected,
  onClick,
}: {
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
      data-user-autocomplete-item
      type="button"
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
