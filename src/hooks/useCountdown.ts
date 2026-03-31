import { useEffect, useState } from "react";

/**
 * Returns a live countdown string ("0:42") to a future Unix timestamp (seconds).
 * Ticks every second. Returns null when the target is in the past.
 */
export function useCountdown(
  targetUnixSeconds: number | undefined,
): string | null {
  const [remaining, setRemaining] = useState<number | null>(() => {
    if (targetUnixSeconds === undefined) return null;
    const secs = targetUnixSeconds - Math.floor(Date.now() / 1000);
    return secs > 0 ? secs : null;
  });

  useEffect(() => {
    if (targetUnixSeconds === undefined) {
      setRemaining(null);
      return;
    }

    const tick = () => {
      const secs = targetUnixSeconds - Math.floor(Date.now() / 1000);
      setRemaining(secs > 0 ? secs : null);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetUnixSeconds]);

  if (remaining === null) return null;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
