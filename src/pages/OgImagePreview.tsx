/**
 * OG Image Preview — Option 5 (final)
 *
 * Tagline as hero, logo+name bottom-left, "powered by Git & Nostr" bottom-right.
 * Screenshot with Playwright to produce public/og-image.png at 1200×630.
 */

function LogoIcon({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        width="64"
        height="64"
        rx={Math.round((16 / 64) * size)}
        fill="#9333EA"
      />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M14.999 34.961v-17.96h4v17.96c0 3.172 1.492 6.152 4.015 8.036L28.377 47a14.026 14.026 0 0 1 5.622 11.24V64h-4v-5.76c0-3.17-1.492-6.15-4.015-8.035l-5.363-4.004a14.027 14.027 0 0 1-5.622-11.24Z"
        clipRule="evenodd"
      />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M48.999 34.961v-17.96h-4v17.96c0 3.172-1.492 6.152-4.015 8.036L35.62 47a14.027 14.027 0 0 0-5.622 11.24V64h4v-5.76c0-3.17 1.492-6.15 4.015-8.035l5.363-4.004A14.027 14.027 0 0 0 49 34.962Z"
        clipRule="evenodd"
      />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M29.799 64.001V27.887h4.4V64h-4.4Z"
        clipRule="evenodd"
      />
      <path
        fill="#fff"
        d="M40.999 18.001a6 6 0 1 1 12 0 6 6 0 0 1-12 0Zm-29.985 0a6 6 0 1 1 12 0 6 6 0 0 1-12 0Zm15.985 12a5 5 0 1 1 10 0 5 5 0 0 1-10 0Z"
      />
    </svg>
  );
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

function OgImage() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        background: "#13141c",
        position: "relative",
        overflow: "hidden",
        fontFamily: FONT,
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 6,
          height: "100%",
          background: "linear-gradient(180deg, #9333ea 0%, #ff79c6 100%)",
        }}
      />

      {/* Dot grid + glows */}
      <svg
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        width="1200"
        height="630"
      >
        <defs>
          <pattern
            id="dots5"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" fill="white" fillOpacity="0.06" />
          </pattern>
          <radialGradient id="rg5" cx="70%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#ff79c6" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#ff79c6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rg5b" cx="20%" cy="70%" r="45%">
            <stop offset="0%" stopColor="#9333ea" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#9333ea" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1200" height="630" fill="url(#dots5)" />
        <ellipse cx="840" cy="252" rx="500" ry="380" fill="url(#rg5)" />
        <ellipse cx="240" cy="441" rx="400" ry="300" fill="url(#rg5b)" />
      </svg>

      {/* Hero tagline */}
      <div
        style={{
          position: "absolute",
          top: 185,
          left: 86,
          right: 80,
          zIndex: 1,
          fontSize: 84,
          fontWeight: 900,
          letterSpacing: "-4px",
          lineHeight: 1.15,
          color: "#ede9f6",
        }}
      >
        git collaboration
        <br />
        <span
          style={{
            background: "linear-gradient(90deg, #9333ea 0%, #ff79c6 60%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          without the platform
        </span>
      </div>

      {/* Footer row: logo+name left · powered-by right */}
      <div
        style={{
          position: "absolute",
          bottom: 52,
          left: 86,
          right: 80,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <LogoIcon size={52} />
          <div
            style={{
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: "-1.5px",
              lineHeight: 1,
            }}
          >
            <span style={{ color: "#ede9f6" }}>Git</span>
            <span style={{ color: "#ff79c6" }}>Workshop</span>
          </div>
        </div>

        <div
          style={{
            fontSize: 22,
            fontWeight: 400,
            color: "#6b6880",
            letterSpacing: "0.2px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          powered by
          <span style={{ color: "#9b8fb0", fontWeight: 600 }}>Git</span>
          <span style={{ color: "#4a4560" }}>&amp;</span>
          <span style={{ color: "#c084fc", fontWeight: 600 }}>Nostr</span>
        </div>
      </div>
    </div>
  );
}

export default function OgImagePreview() {
  return (
    <div
      style={{
        background: "#0a0a0f",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT,
      }}
    >
      <div
        id="og-option-5"
        style={{
          width: 1200,
          height: 630,
          outline: "2px solid rgba(147,51,234,0.3)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <OgImage />
      </div>
    </div>
  );
}
