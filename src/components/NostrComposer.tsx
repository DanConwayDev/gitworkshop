/**
 * NostrComposer — a drop-in replacement for <Textarea> with nostr-aware features:
 *
 * - Write / Preview toggle (controlled by parent via activeTab / onTabChange)
 * - @ mention autocomplete via MentionAutocomplete
 * - NIP-19 paste → nostr: prefix normalisation
 * - nsec guard with inline warning
 * - NIP-19 embed preview chips below the textarea
 * - Blossom image upload via paste or triggerAttach() on the forwarded ref
 * - onUploadedTags: fires with NIP-94 tags after each upload so parents can
 *   inject imeta tags into published events
 *
 * The upload button and Write/Preview toggle live in the parent's action row,
 * not inside this component. Use the forwarded ref to call triggerAttach() and
 * read isUploading from it.
 */
import {
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { nip19 } from "nostr-tools";
import { AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { CommentContent } from "@/components/CommentContent";
import { MentionAutocomplete } from "@/components/MentionAutocomplete";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { useBlossomUpload, type Nip94Tags } from "@/hooks/useBlossomUpload";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// NIP-19 regex — matches bare identifiers not already preceded by "nostr:"
// ---------------------------------------------------------------------------

const NIP19_BARE_RE =
  /(?<=^|\s)(npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/gm;

const NSEC_RE = /nsec1[023456789acdefghjklmnpqrstuvwxyz]+/;

const NOSTR_EMBED_RE =
  /nostr:(npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/g;

// ---------------------------------------------------------------------------
// Imperative handle — exposed to parents via ref
// ---------------------------------------------------------------------------

export interface NostrComposerHandle {
  /** Open the file picker to attach an image/video */
  triggerAttach: () => void;
  /** True while a Blossom upload is in progress */
  isUploading: boolean;
}

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
  /** Controlled preview mode — owned by the parent */
  activeTab?: "write" | "preview";
  onTabChange?: (tab: "write" | "preview") => void;
  onFocusChange?: (focused: boolean) => void;
  /** Pubkeys to surface first in @ mention results */
  priorityPubkeys?: string[];
  /**
   * Called after each successful Blossom upload with the NIP-94 tag array.
   * Use this to accumulate imeta tags for injection into the published event.
   */
  onUploadedTags?: (tags: Nip94Tags) => void;
  /**
   * CSS max-height for the auto-expanding textarea (e.g. "40vh", "300px").
   * Defaults to "60vh" so the composer never overflows a modal or viewport.
   */
  maxHeight?: string;
  /** Auto-focus the textarea on mount */
  autoFocus?: boolean;
}

// ---------------------------------------------------------------------------
// NostrComposer
// ---------------------------------------------------------------------------

export const NostrComposer = forwardRef<
  NostrComposerHandle,
  NostrComposerProps
>(function NostrComposer(
  {
    value,
    onChange,
    placeholder,
    disabled,
    rows = 6,
    className,
    minRows,
    maxHeight = "60vh",
    activeTab: activeTabProp,
    onTabChange,
    onFocusChange,
    priorityPubkeys,
    onUploadedTags,
    autoFocus,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [internalTab, setInternalTab] = useState<"write" | "preview">("write");
  const activeTab = activeTabProp ?? internalTab;
  const _setActiveTab = onTabChange ?? setInternalTab;

  const { uploadFile, isUploading } = useBlossomUpload();

  // Expose triggerAttach + isUploading to parents
  useImperativeHandle(
    ref,
    () => ({
      triggerAttach: () => fileInputRef.current?.click(),
      isUploading,
    }),
    [isUploading],
  );

  // Detect nsec in value
  const hasNsec = NSEC_RE.test(value);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value.replace(NIP19_BARE_RE, "nostr:$&");
      onChange(newValue);
      // Collapse back to write mode when content is cleared
      if (!newValue) _setActiveTab("write");
    },
    [onChange, _setActiveTab],
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

  // Insert a URL at the current cursor position (or append)
  const insertUrl = useCallback(
    (url: string) => {
      const textarea = textareaRef.current;
      const pos = textarea?.selectionStart ?? value.length;
      const before = value.slice(0, pos);
      const after = value.slice(pos);
      const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
      const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
      const insertion = `${prefix}${url}${suffix}`;
      const newValue = before + insertion + after;
      onChange(newValue);

      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const newPos = pos + insertion.length;
        ta.setSelectionRange(newPos, newPos);
        ta.focus();
      });
    },
    [value, onChange],
  );

  // Handle file selected via the hidden file input
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const tags = await uploadFile(file);
      if (tags) {
        insertUrl(tags[0][1]);
        onUploadedTags?.(tags);
      }
    },
    [uploadFile, insertUrl, onUploadedTags],
  );

  // Handle paste — intercept image data from clipboard
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;

      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const tags = await uploadFile(file);
      if (tags) {
        insertUrl(tags[0][1]);
        onUploadedTags?.(tags);
      }
    },
    [uploadFile, insertUrl, onUploadedTags],
  );

  // Extract unique nostr: identifiers from value for preview chips
  const embedIdentifiers = useMemo(() => {
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    NOSTR_EMBED_RE.lastIndex = 0;
    while ((match = NOSTR_EMBED_RE.exec(value)) !== null) {
      matches.add(match[0]);
      if (matches.size >= 5) break;
    }
    return Array.from(matches);
  }, [value]);

  const minHeight = minRows ? `${minRows * 1.5}rem` : undefined;

  return (
    <div className="space-y-2">
      {/* Hidden file input — triggered by parent via ref.triggerAttach() */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || isUploading}
      />

      {/* Composer box: textarea or preview */}
      <div className="rounded-md border border-input bg-background/60 focus-within:ring-1 focus-within:ring-ring overflow-hidden">
        {/* Write area */}
        <div className={cn(activeTab === "preview" ? "hidden" : undefined)}>
          <WriteArea
            textareaRef={textareaRef}
            value={value}
            onChange={handleChange}
            onInsertMention={handleInsertMention}
            onFocusChange={onFocusChange}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled || isUploading}
            rows={rows}
            className={className}
            minHeight={minHeight}
            maxHeight={maxHeight}
            priorityPubkeys={priorityPubkeys}
            autoFocus={autoFocus}
          />
        </div>

        {/* Preview area */}
        {activeTab === "preview" && (
          <div
            className={cn(
              "px-3 py-2 text-sm overflow-auto",
              "[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-border/80",
              className,
            )}
            style={{
              minHeight: minHeight ?? `${rows * 1.5}rem`,
              scrollbarWidth: "thin",
              scrollbarColor: "hsl(var(--border)) transparent",
            }}
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
});

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
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
  priorityPubkeys?: string[];
  autoFocus?: boolean;
}

function WriteArea({
  textareaRef,
  value,
  onChange,
  onInsertMention,
  onFocusChange,
  onPaste,
  placeholder,
  disabled,
  rows,
  className,
  minHeight,
  maxHeight = "60vh",
  priorityPubkeys,
  autoFocus,
}: WriteAreaProps) {
  // Auto-expand: reset height to "auto" first so scrollHeight reflects the
  // true content height, then clamp to maxHeight.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value, textareaRef]);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={onChange}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onPaste={onPaste}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        autoFocus={autoFocus}
        className={cn(
          "resize-none text-sm border-0 shadow-none focus-visible:ring-0 bg-transparent overflow-y-auto",
          // Style native scrollbar to match shadcn ScrollBar (bg-border thumb, thin track)
          "[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-border/80",
          className,
        )}
        style={{
          ...(minHeight ? { minHeight } : undefined),
          maxHeight,
          scrollbarWidth: "thin",
          scrollbarColor: "hsl(var(--border)) transparent",
        }}
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
  const { name: displayName, isPlaceholder } = useUserDisplayName(pubkey);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted pl-0.5 pr-2 py-0.5 text-xs">
      <UserAvatar pubkey={pubkey} size="xs" className="shrink-0" />
      <span
        className={cn(
          "font-medium",
          isPlaceholder ? "text-muted-foreground font-mono" : "text-foreground",
        )}
      >
        {displayName}
      </span>
    </span>
  );
}
