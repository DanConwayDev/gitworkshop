import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * Alignment of the popover relative to its trigger, matching the values
 * accepted by Radix's `<PopoverContent align>`. The hook needs this to
 * compute the correct shift, since Radix anchors the popover wrapper to a
 * different edge of the trigger depending on alignment.
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
   * because Radix anchors a popover differently depending on alignment:
   * - `start` anchors its left edge to the trigger's left
   * - `end` anchors its right edge to the trigger's right
   * - `center` centres it on the trigger
   *
   * The hook applies the shift in whichever direction will actually move
   * the popover within Radix's anchored wrapper.
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
   * the popover to fill the viewport (minus the optional margin) and applies
   * the negative `marginLeft` / `marginRight` shift required to push it to
   * the viewport edges regardless of where the trigger is or which `align`
   * was passed. On desktop returns an empty object.
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
 * Radix anchors `<PopoverContent>` to its trigger and exposes an `align`
 * prop that pins one edge of the popover wrapper to the corresponding edge
 * of the trigger:
 *
 * - `align="start"` → wrapper.left = trigger.left
 * - `align="end"`   → wrapper.right = trigger.right
 * - `align="center"`→ wrapper.center = trigger.center
 *
 * On mobile we want the popover to span the full viewport (minus an
 * optional inset) regardless of where the trigger sits, so the popover
 * doesn't end up with very uneven left/right gaps. To do that we need to
 * shift the popover *within* its anchored wrapper. Block-level margins on
 * the content element are the only thing Radix doesn't overwrite, but the
 * direction of the shift depends on alignment:
 *
 * - For `align="start"` we apply `marginLeft = margin - trigger.left` to
 *   push the popover right (away from the wrapper's left-anchored edge).
 * - For `align="end"` we apply `marginRight = trigger.right - (viewport -
 *   margin)` (a negative number — the popover's right edge sits at
 *   trigger.right by default, so we need a negative margin to "grow" it
 *   rightwards past trigger.right and reach the viewport edge).
 * - For `align="center"` we apply whichever margin produces the correct
 *   shift direction.
 *
 * The hook also (optionally) smoothly scrolls the trigger into view when
 * the popover opens on mobile, so the trigger and popover content stay
 * visible together.
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

    const baseStyle: React.CSSProperties = {
      width: `${popoverWidth}px`,
      maxWidth: `${popoverWidth}px`,
    };

    switch (align) {
      case "end": {
        // Radix pins wrapper.right to trigger.right, so the popover's right
        // edge is already at trigger.right by default. To push it to
        // viewportWidth - margin we need a negative marginRight that grows
        // the wrapper rightwards.
        const marginRight = rect.right - (viewportWidth - margin);
        setPopoverStyle({
          ...baseStyle,
          marginLeft: 0,
          marginRight: `${marginRight}px`,
        });
        return;
      }
      case "center": {
        // Radix centres the wrapper on the trigger. Compute the shift needed
        // to centre on the viewport instead, and apply it as marginLeft
        // (positive: shift right) or marginRight (negative: shift left).
        const triggerCenter = rect.left + rect.width / 2;
        const viewportCenter = viewportWidth / 2;
        const shift = viewportCenter - triggerCenter;
        if (shift >= 0) {
          setPopoverStyle({
            ...baseStyle,
            marginLeft: `${shift}px`,
            marginRight: 0,
          });
        } else {
          setPopoverStyle({
            ...baseStyle,
            marginLeft: 0,
            marginRight: `${shift}px`,
          });
        }
        return;
      }
      case "start":
      default: {
        // Radix pins wrapper.left to trigger.left, so the popover's left
        // edge sits at trigger.left by default. Apply a positive marginLeft
        // (or negative if the trigger is past the desired margin) to shift
        // the popover to viewport-left + margin.
        const marginLeft = margin - rect.left;
        setPopoverStyle({
          ...baseStyle,
          marginLeft: `${marginLeft}px`,
          marginRight: 0,
        });
        return;
      }
    }
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
