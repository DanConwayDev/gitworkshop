import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * Options for `useMobilePopoverFullWidth`.
 */
export interface UseMobilePopoverFullWidthOptions {
  /** Whether the popover is currently open. Required so we can recompute on open and attach/detach listeners. */
  open: boolean;
  /** Margin in px from the viewport edges on mobile. Defaults to 8. */
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
   * the popover to fill the viewport (minus margin) and shifts it so its left
   * edge sits at the viewport's left margin regardless of where the trigger is.
   * On desktop returns an empty object.
   */
  popoverStyle: React.CSSProperties;
  /**
   * Convenience flag for the consumer to forward to `<PopoverContent
   * avoidCollisions={!isMobile}>`. We disable Radix's collision avoidance on
   * mobile because we're positioning the popover ourselves.
   */
  avoidCollisions: boolean;
  /** Whether the current viewport is mobile-sized. */
  isMobile: boolean;
}

/**
 * Shared mobile-fullwidth popover sizing/positioning logic.
 *
 * On mobile, a popover anchored to a trigger near the right side of the
 * screen with `align="end"` only widens leftward up to the trigger's right
 * edge — leaving large left-side gaps. This hook computes inline width and
 * negative `marginLeft` so the popover always spans the full viewport
 * (minus a small margin) regardless of the trigger's horizontal position.
 *
 * Also (optionally) smoothly scrolls the trigger into view when the popover
 * opens on mobile, so the trigger and popover content stay visible together.
 *
 * Usage:
 *
 * ```tsx
 * const { triggerRef, popoverStyle, avoidCollisions, isMobile } =
 *   useMobilePopoverFullWidth({ open });
 *
 * return (
 *   <Popover open={open} onOpenChange={setOpen}>
 *     <PopoverTrigger asChild>
 *       <button ref={triggerRef}>…</button>
 *     </PopoverTrigger>
 *     <PopoverContent
 *       className={isMobile ? "w-screen" : "w-[420px]"}
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
  margin = 8,
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
    setPopoverStyle({
      width: `calc(100vw - ${margin * 2}px)`,
      maxWidth: `calc(100vw - ${margin * 2}px)`,
      marginLeft: `-${rect.left - margin}px`,
    });
  }, [isMobile, margin]);

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
