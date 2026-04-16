/**
 * BlossomMedia — thin wrappers around <img> and <video> that use
 * useBlossomFallback to automatically try alternative Blossom servers when
 * the primary URL fails to load.
 *
 * Usage:
 *   <BlossomImage src={url} alt="..." className="..." />
 *   <BlossomVideo src={url} className="..." />
 */

import React from "react";
import { useBlossomFallback } from "@/hooks/useBlossomFallback";

type BlossomImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

/**
 * Convert a bare numeric string like "70" to a CSS value "70px".
 * Tailwind's preflight applies `height: auto` to all img elements, which
 * overrides HTML width/height attributes. Promoting them to inline styles
 * (higher specificity) avoids this conflict.
 */
function toCssSize(
  value: string | number | undefined,
): string | number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value; // React appends 'px' for unitless numbers
  if (/^\d+$/.test(value)) return `${value}px`; // bare digit string → add px unit
  return value; // already has a unit or is a keyword (e.g. "50%", "auto")
}

export function BlossomImage({
  src,
  alt = "",
  className,
  loading = "lazy",
  width,
  height,
  style,
  ...rest
}: BlossomImageProps) {
  const { src: resolvedSrc, onError } = useBlossomFallback(src);

  // Build merged inline styles so that explicit width/height values from HTML
  // attributes override Tailwind's preflight `height: auto` rule.
  const sizeStyle: React.CSSProperties = {};
  const w = toCssSize(width);
  const h = toCssSize(height);
  if (w !== undefined) sizeStyle.width = w;
  if (h !== undefined) sizeStyle.height = h;
  const mergedStyle =
    Object.keys(sizeStyle).length > 0 ? { ...sizeStyle, ...style } : style;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      loading={loading}
      onError={onError}
      style={mergedStyle}
      {...rest}
    />
  );
}

interface BlossomVideoProps {
  src: string;
  className?: string;
}

export function BlossomVideo({ src, className }: BlossomVideoProps) {
  const { src: resolvedSrc, onError } = useBlossomFallback(src);
  return (
    <video
      src={resolvedSrc}
      controls
      className={className}
      preload="metadata"
      onError={onError}
    />
  );
}
