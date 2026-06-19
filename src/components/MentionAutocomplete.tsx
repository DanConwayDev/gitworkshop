import { useState, useEffect, useCallback, useId } from "react";
import { nip19 } from "nostr-tools";
import { UserAutocompleteDropdown } from "@/components/UserAutocompleteDropdown";

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
  const listboxId = useId();
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [activeDescendantId, setActiveDescendantId] = useState<
    string | undefined
  >();
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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.setAttribute("aria-autocomplete", "list");
    textarea.setAttribute("aria-expanded", String(isOpen));
    textarea.setAttribute("aria-haspopup", "listbox");

    if (isOpen) textarea.setAttribute("aria-controls", listboxId);
    else textarea.removeAttribute("aria-controls");

    if (isOpen && activeDescendantId) {
      textarea.setAttribute("aria-activedescendant", activeDescendantId);
    } else {
      textarea.removeAttribute("aria-activedescendant");
    }

    return () => {
      textarea.removeAttribute("aria-autocomplete");
      textarea.removeAttribute("aria-expanded");
      textarea.removeAttribute("aria-haspopup");
      textarea.removeAttribute("aria-controls");
      textarea.removeAttribute("aria-activedescendant");
    };
  }, [activeDescendantId, isOpen, listboxId, textareaRef]);

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
      listboxId={listboxId}
      onActiveDescendantChange={setActiveDescendantId}
    />
  );
}
