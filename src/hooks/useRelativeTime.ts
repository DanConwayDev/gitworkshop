import { formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";

/**
 * Returns a reactive relative-time string (e.g. "3 minutes ago") that
 * automatically refreshes every `intervalMs` milliseconds.
 *
 * @param unixSeconds - Unix timestamp in seconds
 * @param intervalMs  - How often to refresh (default: 10 000 ms)
 */
export function useRelativeTime(
  unixSeconds: number,
  intervalMs = 10_000,
): string {
  const [label, setLabel] = useState(() =>
    formatDistanceToNow(new Date(unixSeconds * 1000), { addSuffix: true }),
  );

  useEffect(() => {
    // Recompute immediately when the timestamp changes
    setLabel(
      formatDistanceToNow(new Date(unixSeconds * 1000), { addSuffix: true }),
    );

    const id = setInterval(() => {
      setLabel(
        formatDistanceToNow(new Date(unixSeconds * 1000), { addSuffix: true }),
      );
    }, intervalMs);

    return () => clearInterval(id);
  }, [unixSeconds, intervalMs]);

  return label;
}
