/**
 * SyncedScrollArea — overflow-x-auto container with a smart horizontal
 * scrollbar that is always reachable:
 *
 * - When the component bottom is visible in the viewport the bar sits
 *   naturally at the bottom of the component (position: sticky bottom-0).
 * - When the user has scrolled so the component bottom is below the viewport
 *   bottom the bar switches to position: fixed at the viewport bottom so it
 *   floats while you scroll through the content.
 * - When the component has been scrolled entirely above the viewport the bar
 *   returns to the bottom of the component (no longer fixed).
 *
 * Both the in-flow bar and the fixed bar share the same ref and stay in sync
 * with the content scroll position via bidirectional scroll listeners.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface SyncedScrollAreaProps {
  children: React.ReactNode;
  className?: string;
}

export function SyncedScrollArea({
  children,
  className,
}: SyncedScrollAreaProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const [scrollWidth, setScrollWidth] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);

  // When fixed: position/size of the bar in viewport coords
  const [fixedStyle, setFixedStyle] = useState<{
    fixed: boolean;
    left: number;
    width: number;
  }>({ fixed: false, left: 0, width: 0 });

  const hasOverflow = scrollWidth > clientWidth;

  // Track content scroll/client width via ResizeObserver
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => {
      setScrollWidth(content.scrollWidth);
      setClientWidth(content.clientWidth);
    });
    ro.observe(content);
    const table = content.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, []);

  const updateFixedStyle = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const vh = window.innerHeight;
    // Switch to fixed only while the card bottom is below the viewport bottom
    // (native scrollbar would be off-screen) AND the card top is still above
    // the viewport bottom (card is at least partially visible).
    const shouldFix = rect.bottom > vh && rect.top < vh;
    setFixedStyle({ fixed: shouldFix, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    updateFixedStyle();
    window.addEventListener("scroll", updateFixedStyle, { passive: true });
    window.addEventListener("resize", updateFixedStyle, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateFixedStyle);
      window.removeEventListener("resize", updateFixedStyle);
    };
  }, [updateFixedStyle]);

  useEffect(() => {
    updateFixedStyle();
  }, [hasOverflow, updateFixedStyle]);

  // Sync: content → bar
  const onContentScroll = useCallback(() => {
    if (syncingRef.current) return;
    const bar = barRef.current;
    const content = contentRef.current;
    if (!bar || !content) return;
    syncingRef.current = true;
    bar.scrollLeft = content.scrollLeft;
    syncingRef.current = false;
  }, []);

  // Sync: bar → content
  const onBarScroll = useCallback(() => {
    if (syncingRef.current) return;
    const bar = barRef.current;
    const content = contentRef.current;
    if (!bar || !content) return;
    syncingRef.current = true;
    content.scrollLeft = bar.scrollLeft;
    syncingRef.current = false;
  }, []);

  return (
    <div ref={wrapperRef}>
      {/* Scrollable content — native scrollbar hidden */}
      <div
        ref={contentRef}
        onScroll={onContentScroll}
        className={className ?? "overflow-x-auto [&::-webkit-scrollbar]:hidden"}
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>

      {/* Mirror scrollbar — only rendered when there is horizontal overflow */}
      {hasOverflow && (
        <div
          ref={barRef}
          onScroll={onBarScroll}
          className="overflow-x-auto overflow-y-hidden h-3 bg-background/95 border-t border-border/60 backdrop-blur-sm z-50"
          style={
            fixedStyle.fixed
              ? {
                  position: "fixed",
                  bottom: 0,
                  left: fixedStyle.left,
                  width: fixedStyle.width,
                  scrollbarWidth: "thin",
                }
              : {
                  position: "sticky",
                  bottom: 0,
                  scrollbarWidth: "thin",
                }
          }
        >
          <div style={{ width: scrollWidth, height: 1 }} />
        </div>
      )}
    </div>
  );
}
