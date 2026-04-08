/**
 * foregroundResume$ — global singleton observable for foreground resume events.
 *
 * Emits when the app returns to the foreground after being backgrounded for
 * longer than the platform threshold:
 *   - Android: 3 seconds  (WebSocket connections zombie almost immediately)
 *   - Other:   30 seconds (desktop browsers freeze tabs after ~5 min; 30s
 *                          avoids false positives from quick alt-tabs)
 *
 * Framework-agnostic — no React dependency. Safe to import from lib files.
 * No-op in non-browser environments (SSR safety).
 *
 * Usage:
 *   import { foregroundResume$ } from '@/lib/foregroundResume';
 *   foregroundResume$.subscribe(({ backgroundDurationMs }) => {
 *     // reconnect / gap-fill
 *   });
 */

import { Subject } from "rxjs";
import type { Observable } from "rxjs";

export interface ForegroundResumeEvent {
  /** How long the app was in the background, in milliseconds */
  backgroundDurationMs: number;
}

/** Threshold in ms below which a resume is ignored (quick alt-tab, etc.) */
const ANDROID_THRESHOLD_MS = 3_000;
const DEFAULT_THRESHOLD_MS = 30_000;

function isAndroid(): boolean {
  return (
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
  );
}

// Internal Subject — module-level singleton.
const _subject = new Subject<ForegroundResumeEvent>();

// Lazy initialization: only add the DOM listener in browser environments.
// Module-level side effects are acceptable in this Vite/browser-only app.
if (typeof document !== "undefined") {
  const threshold = isAndroid() ? ANDROID_THRESHOLD_MS : DEFAULT_THRESHOLD_MS;
  let hiddenAt: number | null = null;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
    } else if (document.visibilityState === "visible") {
      if (hiddenAt === null) return;
      const backgroundDurationMs = Date.now() - hiddenAt;
      hiddenAt = null;
      if (backgroundDurationMs >= threshold) {
        _subject.next({ backgroundDurationMs });
      }
    }
  });
}

/**
 * Shared observable — emits on every qualifying foreground resume.
 * No initial value (not a BehaviorSubject) — only emits on actual resume events.
 */
export const foregroundResume$: Observable<ForegroundResumeEvent> =
  _subject.asObservable();
