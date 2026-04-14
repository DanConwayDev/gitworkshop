/**
 * BlossomMedia — thin wrappers around <img> and <video> that use
 * useBlossomFallback to automatically try alternative Blossom servers when
 * the primary URL fails to load.
 *
 * Usage:
 *   <BlossomImage src={url} alt="..." className="..." />
 *   <BlossomVideo src={url} className="..." />
 */

import { useBlossomFallback } from "@/hooks/useBlossomFallback";

interface BlossomImageProps {
  src: string;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
}

export function BlossomImage({
  src,
  alt = "",
  className,
  loading = "lazy",
}: BlossomImageProps) {
  const { src: resolvedSrc, onError } = useBlossomFallback(src);
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      loading={loading}
      onError={onError}
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
