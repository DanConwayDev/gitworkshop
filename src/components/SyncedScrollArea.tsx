/**
 * SyncedScrollArea — overflow-x-auto container with a viewport-fixed
 * horizontal scrollbar at the bottom of the screen.
 *
 * The fixed bar is only visible while the component is "straddling" the
 * viewport bottom — i.e. the top of the element is above the viewport bottom
 * and the bottom of the element is below it — so it appears exactly when the
 * native bottom scrollbar would be off-screen.
 *
 * Both bars stay in sync via bidirectional scroll event listeners.
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
  const fixedBarRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const [scrollWidth, setScrollWidth] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);
  const [barStyle, setBarStyle] = useState<{
    left: number;
    width: number;
    visible: boolean;
  }>({ left: 0, width: 0, visible: false });

  // Track content scroll width and client width via ResizeObserver
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

  const hasOverflow = scrollWidth > clientWidth;

  // Update fixed bar position/visibility on scroll + resize
  const updateBarStyle = useCallback(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const rect = wrapper.getBoundingClientRect();
    const vh = window.innerHeight;
    const straddling = rect.top < vh && rect.bottom > vh;

    setBarStyle({
      left: rect.left,
      width: rect.width,
      visible: straddling && hasOverflow,
    });
  }, [hasOverflow]);

  useEffect(() => {
    updateBarStyle();
    window.addEventListener("scroll", updateBarStyle, { passive: true });
    window.addEventListener("resize", updateBarStyle, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateBarStyle);
      window.removeEventListener("resize", updateBarStyle);
    };
  }, [updateBarStyle]);

  useEffect(() => {
    updateBarStyle();
  }, [hasOverflow, updateBarStyle]);

  // Sync: content → fixed bar
  const onContentScroll = useCallback(() => {
    if (syncingRef.current) return;
    const content = contentRef.current;
    const fixedBar = fixedBarRef.current;
    if (!content || !fixedBar) return;
    syncingRef.current = true;
    fixedBar.scrollLeft = content.scrollLeft;
    syncingRef.current = false;
  }, []);

  // Sync: fixed bar → content
  const onFixedBarScroll = useCallback(() => {
    if (syncingRef.current) return;
    const content = contentRef.current;
    const fixedBar = fixedBarRef.current;
    if (!content || !fixedBar) return;
    syncingRef.current = true;
    content.scrollLeft = fixedBar.scrollLeft;
    syncingRef.current = false;
  }, []);

  return (
    <div ref={wrapperRef}>
      {/* Actual scrollable content — native scrollbar hidden via CSS */}
      <div
        ref={contentRef}
        onScroll={onContentScroll}
        className={className ?? "overflow-x-auto [&::-webkit-scrollbar]:hidden"}
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>

      {/* Viewport-fixed mirror scrollbar */}
      {barStyle.visible && (
        <div
          ref={fixedBarRef}
          onScroll={onFixedBarScroll}
          className="fixed bottom-0 z-50 overflow-x-auto overflow-y-hidden h-3 bg-background/95 border-t border-border/60 backdrop-blur-sm"
          style={{
            left: barStyle.left,
            width: barStyle.width,
            scrollbarWidth: "thin",
          }}
        >
          <div style={{ width: scrollWidth, height: 1 }} />
        </div>
      )}
    </div>
  );
}
