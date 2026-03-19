/**
 * Stacked-server icon with coloured status lights.
 *
 * Inspired by gitworkshop's ExplorerServerStatusIcon — three stacked server
 * blocks, each with two small indicator lights that reflect the status of up
 * to three servers. When fewer than three servers exist the extra rows are
 * drawn without lights.
 *
 * Status mapping:
 *   "match"   → green (success)
 *   "behind"  → amber (warning)
 *   "ahead"   → amber (warning)
 *   "error"   → red
 *   "unknown" → pulsing grey (fetching — not yet a problem)
 */

import { cn } from "@/lib/utils";

type ServerState = "success" | "warning" | "error" | "loading" | undefined;

function mapStatus(
  status: string | undefined,
): "success" | "warning" | "error" | "loading" {
  switch (status) {
    case "match":
      return "success";
    case "behind":
    case "ahead":
      return "warning";
    case "error":
      return "error";
    case "unknown":
    default:
      return "loading";
  }
}

const stateColors: Record<string, string> = {
  success: "fill-emerald-500",
  warning: "fill-amber-500",
  error: "fill-red-500",
  loading: "fill-muted-foreground/50",
};

interface GitServerStatusIconProps {
  /** Status strings for each server (e.g. "match", "behind", "error", "unknown") */
  statuses: (string | undefined)[];
  className?: string;
}

export function GitServerStatusIcon({
  statuses,
  className,
}: GitServerStatusIconProps) {
  // Map to success/warning/error/loading, sort best-first, trim/pad to 3
  const mapped: ServerState[] = statuses.map(mapStatus).sort((a, b) => {
    const rank = (s: ServerState) =>
      s === "success" ? 0 : s === "warning" ? 1 : s === "error" ? 2 : 3;
    return rank(a) - rank(b);
  });

  // Trim to 3, keeping the most representative
  while (mapped.length > 3) {
    // Remove duplicates from the end: prefer removing error, then warning, then success
    const lastError = mapped.lastIndexOf("error");
    if (lastError !== -1 && mapped.filter((s) => s === "error").length > 1) {
      mapped.splice(lastError, 1);
      continue;
    }
    const lastWarning = mapped.lastIndexOf("warning");
    if (
      lastWarning !== -1 &&
      mapped.filter((s) => s === "warning").length > 1
    ) {
      mapped.splice(lastWarning, 1);
      continue;
    }
    const lastSuccess = mapped.lastIndexOf("success");
    if (lastSuccess !== -1) {
      mapped.splice(lastSuccess, 1);
      continue;
    }
    mapped.pop();
  }

  // Pad to 3 with undefined (no lights)
  while (mapped.length < 3) mapped.push(undefined);

  const rows: [ServerState, ServerState, ServerState] = [
    mapped[0],
    mapped[1],
    mapped[2],
  ];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      className={cn("inline h-4 w-4", className)}
      aria-hidden="true"
    >
      {/* Three stacked server blocks */}
      <path
        className="fill-current opacity-40"
        d="M0 2C0 .9.9 0 2 0h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm0 7c0-1.1.9-2 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm0 7c0-1.1.9-2 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z"
      />

      {/* Status lights — two per row, positioned in the right half */}
      <g pointerEvents="none">
        {rows.map((state, i) => {
          if (!state) return null;
          const y = i === 0 ? 2 : i === 1 ? 9 : 16;
          const isFlashing = state === "loading";
          return (
            <g key={i}>
              <rect
                x={12}
                y={y}
                width={2}
                height={2}
                className={cn(
                  stateColors[state],
                  isFlashing && "animate-pulse",
                )}
              />
              <rect
                x={16}
                y={y}
                width={2}
                height={2}
                className={cn(
                  stateColors[state],
                  isFlashing && "animate-pulse",
                )}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
