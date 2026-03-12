import path from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vitest/config";
import { name } from "./package.json";

/** Replaces %APP_NAME% tokens in index.html at build and dev time. */
function htmlAppNamePlugin(): Plugin {
  return {
    name: "html-app-name",
    transformIndexHtml(html) {
      return html.replace(/%APP_NAME%/g, name);
    },
  };
}

/**
 * Serves manifest.webmanifest with the app name and description sourced from
 * package.json so there is a single source of truth.
 */
function manifestPlugin(): Plugin {
  const virtualId = "/manifest.webmanifest";
  const manifest = JSON.stringify(
    {
      name,
      short_name: name,
      description: "Nostr Git Client",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#000000",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  );

  return {
    name: "manifest",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === virtualId) {
          res.setHeader("Content-Type", "application/manifest+json");
          res.end(manifest);
        } else {
          next();
        }
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: manifest,
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  define: {
    __APP_NAME__: JSON.stringify(name),
  },
  build: {
    sourcemap: true,
    target: ["es2022"],
  },
  esbuild: {
    target: ["es2022"],
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), htmlAppNamePlugin(), manifestPlugin()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    onConsoleLog(log) {
      return !log.includes("React Router Future Flag Warning");
    },
    env: {
      DEBUG_PRINT_LIMIT: "0", // Suppress DOM output that exceeds AI context windows
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
