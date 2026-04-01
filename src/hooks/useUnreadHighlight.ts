import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type HighlightState = "strong" | "subtle" | "none";

interface UseUnreadHighlightResult {
  /** Ref to attach to the comment element. */
  ref: React.RefObject<HTMLElement>;
  /** Current highlight level to apply to the element. */
  highlight: HighlightState;
}

/**
 * Manages the unread/targeted highlight state for a single comment element.
 *
 * Two highlight sources are supported:
 *   1. Hash anchor (#<anchorId>) or oldest-unread (?unread= first entry)
 *      → scroll target: strong highlight that dims to subtle after 3 s of
 *        visibility, then fades to none after a further 3 s.
 *   2. Other unread comments (?unread= list)
 *      → non-scroll-target: starts subtle, fades to none after 3 s of
 *        visibility so the page doesn't stay permanently highlighted.
 *
 * @param anchorId  First 15 chars of the event ID used as the DOM anchor.
 */
export function useUnreadHighlight(anchorId: string): UseUnreadHighlightResult {
  const ref = useRef<HTMLElement>(null);

  const [searchParams] = useSearchParams();
  const { unreadAnchors, firstUnreadAnchor } = useMemo(() => {
    const raw = searchParams.get("unread");
    if (!raw)
      return { unreadAnchors: new Set<string>(), firstUnreadAnchor: undefined };
    const parts = raw.split(",").filter(Boolean);
    return { unreadAnchors: new Set(parts), firstUnreadAnchor: parts[0] };
  }, [searchParams]);

  const isHashTargeted = window.location.hash === `#${anchorId}`;
  const isUnread = unreadAnchors.has(anchorId);
  const isScrollTarget = isHashTargeted || anchorId === firstUnreadAnchor;

  const [highlight, setHighlight] = useState<HighlightState>(
    isScrollTarget || isUnread ? "strong" : "none",
  );

  // --- Scroll-target effect: scroll into view, strong → subtle → none ---
  useEffect(() => {
    if (!isScrollTarget || !ref.current) return;

    const el = ref.current;

    let userScrolled = false;
    const onUserScroll = () => {
      userScrolled = true;
    };
    window.addEventListener("wheel", onUserScroll, {
      passive: true,
      once: true,
    });
    window.addEventListener("touchmove", onUserScroll, {
      passive: true,
      once: true,
    });
    window.addEventListener("keydown", onUserScroll, {
      passive: true,
      once: true,
    });

    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    let dimTimer: ReturnType<typeof setTimeout> | undefined;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            clearTimeout(dimTimer);
            dimTimer = setTimeout(() => {
              setHighlight("subtle");
              // After another 3 s of being visible, fade out entirely
              fadeTimer = setTimeout(() => {
                setHighlight("none");
                observer.disconnect();
              }, 3000);
            }, 3000);
          } else if (dimTimer !== undefined && !userScrolled) {
            // Pushed off-screen by new content before timer fired — scroll back
            clearTimeout(dimTimer);
            dimTimer = undefined;
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            // User scrolled away — stop tracking
            clearTimeout(dimTimer);
            clearTimeout(fadeTimer);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(dimTimer);
      clearTimeout(fadeTimer);
      observer.disconnect();
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.removeEventListener("keydown", onUserScroll);
    };
  }, [isScrollTarget]);

  // --- Non-scroll-target unread: subtle → none after 3 s of visibility ---
  useEffect(() => {
    if (!isUnread || isScrollTarget || !ref.current) return;

    const el = ref.current;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (fadeTimer === undefined) {
              fadeTimer = setTimeout(() => {
                setHighlight("none");
                observer.disconnect();
              }, 3000);
            }
          } else {
            // Scrolled out of view before timer fired — reset so it gets
            // another full 3 s when it comes back into view
            clearTimeout(fadeTimer);
            fadeTimer = undefined;
          }
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(el);

    return () => {
      clearTimeout(fadeTimer);
      observer.disconnect();
    };
  }, [isUnread, isScrollTarget]);

  // Effective highlight: state machine takes precedence; fall back to subtle
  // for unread non-scroll-target comments that haven't been seen yet.
  const effectiveHighlight: HighlightState =
    highlight !== "none"
      ? highlight
      : isUnread && !isScrollTarget
        ? "subtle"
        : "none";

  return { ref, highlight: effectiveHighlight };
}
