import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.gitworkshop.app",
  appName: "GitWorkshop",
  webDir: "dist",
  server: {
    // Serve bundled assets from an HTTPS WebView origin without a remote server.
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#16171e",
  },
};

export default config;
