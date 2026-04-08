/**
 * NostrComposer — a drop-in replacement for <Textarea> with nostr-aware features:
 *
 * - Write / Preview toggle (bottom toolbar, always visible)
 * - @ mention autocomplete via MentionAutocomplete
 * - NIP-19 paste → nostr: prefix normalisation
 * - nsec guard with inline warning
 * - NIP-19 embed preview chips below the textarea
 */
import { useRef, useCallback, useMemo, useState } from "react";
import { nip19 } from "nostr-tools";
import { AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { CommentContent } from "@/components/CommentContent";
import { MentionAutocomplete } from "@/components/MentionAutocomplete";
import { useProfile } from "@/hooks/useProfile";
import { genUserName } from "@/lib/genUserName";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// NIP-19 regex — matches bare identifiers not already preceded by "nostr:"
// ---------------------------------------------------------------------------

const NIP19_BARE_RE =
  /(?<!nostr:)\b(npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+\b/g;

const NSEC_RE = /nsec1[023456789acdefghjklmnpqrstuvwxyz]+/;

// Matches nostr:npub1..., nostr:nprofile1..., nostr:note1..., etc.
const NOSTR_EMBED_RE =
  /nostr:(npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/g;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NostrComposerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  className?: string;
  minRows?: number;
  /** Controlled preview mode — when provided the toggle is owned by the parent */
  activeTab?: "write" | "preview";
  onTabChange?: (tab: "write" | "preview") => void;
  onFocusChange?: (focused: boolean) => void;
  /** Pubkeys to surface first in @ mention results (e.g. repo maintainers, thread participants) */
  priorityPubkeys?: string[];
}

// ---------------------------------------------------------------------------
// NostrComposer
// ---------------------------------------------------------------------------

export function NostrComposer({
  value,
  onChange,
  placeholder,
  disabled,
  rows = 6,
  className,
  minRows,
  activeTab: activeTabProp,
  onTabChange,
  onFocusChange,
  priorityPubkeys,
}: NostrComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [internalTab, setInternalTab] = useState<"write" | "preview">("write");
  const activeTab = activeTabProp ?? internalTab;
  const _setActiveTab = onTabChange ?? setInternalTab;

  // Detect nsec in value
  const hasNsec = NSEC_RE.test(value);

  // Handle value changes: normalise bare NIP-19 identifiers
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      let newValue = e.target.value;

      // Normalise bare NIP-19 identifiers → prepend "nostr:"
      if (NIP19_BARE_RE.test(newValue)) {
        NIP19_BARE_RE.lastIndex = 0; // reset after test
        newValue = newValue.replace(NIP19_BARE_RE, "nostr:$&");
      }

      onChange(newValue);
    },
    [onChange],
  );

  // Insert mention from MentionAutocomplete
  const handleInsertMention = useCallback(
    ({
      start,
      end,
      replacement,
    }: {
      start: number;
      end: number;
      replacement: string;
    }) => {
      const before = value.slice(0, start);
      const after = value.slice(end);
      const newValue = before + replacement + after;
      onChange(newValue);

      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const pos = start + replacement.length;
        textarea.setSelectionRange(pos, pos);
        textarea.focus();
      });
    },
    [value, onChange],
  );

  // Extract unique nostr: identifiers from value for preview chips
  const embedIdentifiers = useMemo(() => {
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    NOSTR_EMBED_RE.lastIndex = 0;
    while ((match = NOSTR_EMBED_RE.exec(value)) !== null) {
      matches.add(match[0]); // e.g. "nostr:npub1abc..."
      if (matches.size >= 5) break;
    }
    return Array.from(matches);
  }, [value]);

  const minHeight = minRows ? `${minRows * 1.5}rem` : undefined;

  return (
    <div className="space-y-2">
      {/* Composer box: textarea (or preview) + bottom toolbar in one bordered unit */}
      <div className="rounded-md border border-input bg-background/60 focus-within:ring-1 focus-within:ring-ring">
        {/* Write area */}
        <div className={cn(activeTab === "preview" ? "hidden" : undefined)}>
          <WriteArea
            textareaRef={textareaRef}
            value={value}
            onChange={handleChange}
            onInsertMention={handleInsertMention}
            onFocusChange={onFocusChange}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows}
            className={className}
            minHeight={minHeight}
            priorityPubkeys={priorityPubkeys}
          />
        </div>

        {/* Preview area */}
        {activeTab === "preview" && (
          <div
            className={cn("px-3 py-2 text-sm overflow-auto", className)}
            style={{ minHeight: minHeight ?? `${rows * 1.5}rem` }}
          >
            <CommentContent content={value} />
          </div>
        )}
      </div>

      {/* nsec guard */}
      {hasNsec && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Secret key detected — remove it before publishing</span>
        </div>
      )}

      {/* NIP-19 embed preview chips (Write mode only) */}
      {activeTab === "write" && embedIdentifiers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {embedIdentifiers.map((identifier) => (
            <EmbedChip key={identifier} identifier={identifier} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WriteArea — textarea + MentionAutocomplete overlay
// ---------------------------------------------------------------------------

interface WriteAreaProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onInsertMention: (params: {
    start: number;
    end: number;
    replacement: string;
  }) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  className?: string;
  minHeight?: string;
  priorityPubkeys?: string[];
}

function WriteArea({
  textareaRef,
  value,
  onChange,
  onInsertMention,
  onFocusChange,
  placeholder,
  disabled,
  rows,
  className,
  minHeight,
  priorityPubkeys,
}: WriteAreaProps) {
  return (
    <div className="relative">
      <Textarea
        ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={onChange}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={cn(
          "resize-y text-sm border-0 shadow-none focus-visible:ring-0 bg-transparent rounded-b-none",
          className,
        )}
        style={minHeight ? { minHeight } : undefined}
      />
      <MentionAutocomplete
        textareaRef={textareaRef}
        content={value}
        onInsertMention={onInsertMention}
        priorityPubkeys={priorityPubkeys}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmbedChip — small preview chip for a nostr: identifier
// ---------------------------------------------------------------------------

function EmbedChip({ identifier }: { identifier: string }) {
  // identifier is like "nostr:npub1abc..." or "nostr:note1abc..."
  const raw = identifier.slice(6); // strip "nostr:"

  let type: string = "";
  let pubkey: string | undefined;

  try {
    const decoded = nip19.decode(raw);
    type = decoded.type;
    if (decoded.type === "npub") {
      pubkey = decoded.data;
    } else if (decoded.type === "nprofile") {
      pubkey = decoded.data.pubkey;
    }
  } catch {
    // invalid — fall through
  }

  if (pubkey) {
    return <ProfileChip pubkey={pubkey} />;
  }

  // note / nevent / naddr — show truncated pill
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
      {raw.slice(0, 12)}…
      {type && (
        <span className="text-[10px] text-muted-foreground/60 uppercase">
          {type}
        </span>
      )}
    </span>
  );
}

function ProfileChip({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const displayName =
    profile?.display_name ??
    profile?.displayName ??
    profile?.name ??
    genUserName(pubkey);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted pl-0.5 pr-2 py-0.5 text-xs">
      <UserAvatar pubkey={pubkey} size="xs" className="shrink-0" />
      <span className="font-medium text-foreground">{displayName}</span>
    </span>
  );
}
