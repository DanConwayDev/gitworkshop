import { useEffect, useState } from "react";

/**
 * Returns a live elapsed-time string ("0:42") since a past Unix timestamp
 * (seconds). Ticks every second. Returns null when the input is undefined.
 *
 * Counterpart to {@link useCountdown} — used by the outbox UI to show how
 * long an in-flight publish has been waiting for a response.
 */
export function useElapsed(
  sinceUnixSeconds: number | undefined,
): string | null {
  const [seconds, setSeconds] = useState<number | null>(() => {
    if (sinceUnixSeconds === undefined) return null;
    const elapsed = Math.floor(Date.now() / 1000) - sinceUnixSeconds;
    return elapsed >= 0 ? elapsed : 0;
  });

  useEffect(() => {
    if (sinceUnixSeconds === undefined) {
      setSeconds(null);
      return;
    }

    const tick = () => {
      const elapsed = Math.floor(Date.now() / 1000) - sinceUnixSeconds;
      setSeconds(elapsed >= 0 ? elapsed : 0);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sinceUnixSeconds]);

  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
