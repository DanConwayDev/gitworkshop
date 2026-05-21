import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * Alignment of the popover relative to its trigger, matching the values
 * accepted by Radix's `<PopoverContent align>`. The hook needs this to
 * compute the correct `marginLeft` shift, since Radix positions the popover
 * differently depending on alignment.
 */
export type PopoverAlign = "start" | "end" | "center";

/**
 * Options for `useMobilePopoverFullWidth`.
 */
export interface UseMobilePopoverFullWidthOptions {
  /** Whether the popover is currently open. Required so we can recompute on open and attach/detach listeners. */
  open: boolean;
  /**
   * The `align` prop you intend to pass to `<PopoverContent>`. Required
   * because Radix positions a popover differently depending on alignment —
   * `start` anchors its left edge to the trigger's left edge, `end` anchors
   * its right edge to the trigger's right edge, `center` centres it. The
   * hook needs to know this to compute the correct `marginLeft` shift that
   * pushes the popover flush against the viewport edges on mobile.
   *
   * Defaults to `"start"`.
   */
  align?: PopoverAlign;
  /**
   * Margin in px from the viewport edges on mobile. Defaults to `0` so the
   * popover sits flush against both viewport edges — a full-width sheet-like
   * presentation. Increase if you want a small inset.
   */
  margin?: number;
  /**
   * When true, smoothly scrolls the trigger into view (below any sticky header)
   * once the popover opens on mobile. Defaults to true. Set to false to disable.
   */
  scrollIntoViewOnMobile?: boolean;
}

/**
 * Result of `useMobilePopoverFullWidth`.
 */
export interface UseMobilePopoverFullWidthResult<
  TElement extends HTMLElement = HTMLButtonElement,
> {
  /** Ref to attach to the popover trigger element. */
  triggerRef: React.RefObject<TElement>;
  /**
   * Inline style to apply to the `<PopoverContent>`. On mobile this widens
   * the popover to fill the viewport (minus the optional margin) and shifts
   * it so both its left and right edges sit at the requested margin from
   * the viewport — regardless of where the trigger is or which `align` was
   * passed. On desktop returns an empty object.
   */
  popoverStyle: React.CSSProperties;
  /**
   * Convenience flag for the consumer to forward to `<PopoverContent
   * avoidCollisions={...}>`. We disable Radix's collision avoidance on
   * mobile because we're positioning the popover ourselves.
   */
  avoidCollisions: boolean;
  /** Whether the current viewport is mobile-sized. */
  isMobile: boolean;
}

/**
 * Shared mobile-fullwidth popover sizing/positioning logic.
 *
 * On mobile, a popover anchored to a trigger near one side of the screen
 * (e.g. a right-aligned dropdown with `align="end"`) widens only as far as
 * its anchor edge before overflowing past the viewport — so the popover ends
 * up with very uneven left/right gaps. This hook computes an inline width
 * and a `marginLeft` shift so the popover is always full-viewport-wide and
 * has equal (or zero) margin on both sides, regardless of trigger position
 * or `align`.
 *
 * Also (optionally) smoothly scrolls the trigger into view when the popover
 * opens on mobile, so the trigger and popover content stay visible together.
 *
 * Usage:
 *
 * ```tsx
 * const { triggerRef, popoverStyle, avoidCollisions, isMobile } =
 *   useMobilePopoverFullWidth({ open, align: "end" });
 *
 * return (
 *   <Popover open={open} onOpenChange={setOpen}>
 *     <PopoverTrigger asChild>
 *       <button ref={triggerRef}>…</button>
 *     </PopoverTrigger>
 *     <PopoverContent
 *       className={isMobile ? "w-screen" : "w-[420px]"}
 *       align="end"
 *       style={popoverStyle}
 *       avoidCollisions={avoidCollisions}
 *     >
 *       …
 *     </PopoverContent>
 *   </Popover>
 * );
 * ```
 */
export function useMobilePopoverFullWidth<
  TElement extends HTMLElement = HTMLButtonElement,
>({
  open,
  align = "start",
  margin = 0,
  scrollIntoViewOnMobile = true,
}: UseMobilePopoverFullWidthOptions): UseMobilePopoverFullWidthResult<TElement> {
  const isMobile = useIsMobile();
  const triggerRef = useRef<TElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const updatePopoverStyle = useCallback(() => {
    if (!isMobile) {
      setPopoverStyle({});
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const popoverWidth = viewportWidth - margin * 2;

    // Radix positions `<PopoverContent>` such that:
    //   align="start"  → popover.left  = trigger.left
    //   align="end"    → popover.right = trigger.right
    //                    → popover.left = trigger.right - popoverWidth
    //   align="center" → popover.left = trigger.left + trigger.width/2 - popoverWidth/2
    //
    // We want popover.left = margin in viewport coords, so we add a
    // `marginLeft` equal to (margin - naturalLeft).
    let naturalLeft: number;
    switch (align) {
      case "end":
        naturalLeft = rect.right - popoverWidth;
        break;
      case "center":
        naturalLeft = rect.left + rect.width / 2 - popoverWidth / 2;
        break;
      case "start":
      default:
        naturalLeft = rect.left;
        break;
    }

    setPopoverStyle({
      width: `${popoverWidth}px`,
      maxWidth: `${popoverWidth}px`,
      marginLeft: `${margin - naturalLeft}px`,
    });
  }, [isMobile, margin, align]);

  // Recompute on open and on resize while open.
  useEffect(() => {
    if (!open) return;
    updatePopoverStyle();
    window.addEventListener("resize", updatePopoverStyle);
    return () => window.removeEventListener("resize", updatePopoverStyle);
  }, [open, updatePopoverStyle]);

  // Smoothly scroll the trigger into view (below any sticky header) on open.
  useEffect(() => {
    if (!open || !isMobile || !scrollIntoViewOnMobile) return;
    const el = triggerRef.current;
    if (!el) return;
    const id = setTimeout(() => {
      const stickyHeader = document.querySelector("header.sticky");
      const headerHeight = stickyHeader
        ? stickyHeader.getBoundingClientRect().height
        : 0;
      const triggerTop =
        el.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
      window.scrollTo({ top: triggerTop, behavior: "smooth" });
    }, 50);
    return () => clearTimeout(id);
  }, [open, isMobile, scrollIntoViewOnMobile]);

  return {
    triggerRef,
    popoverStyle,
    avoidCollisions: !isMobile,
    isMobile,
  };
}
