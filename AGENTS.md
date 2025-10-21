# Agent Rules Standard (AGENTS.md)

## Summary

gitworkshop.dev is a decentralized alternative to GitHub built on Nostr. It's a web application (PWA) for collaborating on issues and code PRs for git repositories via Nostr relays. The application implements a sophisticated multi-threaded architecture that separates internal UI components from external data processing components, bridging them through a central `query-centre`.

## Entry points / where to run

- **Development**: Run locally with `pnpm run dev` for development server
- **Production**: Deployed at https://gitworkshop.dev with same local experience
- **PWA**: Progressive Web App functionality available
- **Nostr Integration**: Connects to Nostr relays for data synchronization
- **Git Operations**: Browser-based Git operations via isomorphic-git

## Setup (install/build)

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build

# Type checking
pnpm run check

# Format code
pnpm run format
```

## Test and lint commands

```bash
# Run unit tests
pnpm run test:unit

# Run tests once
pnpm run test

# Type checking in watch mode
pnpm run check:watch

# Lint and format check
pnpm run lint
```

## Formatters and style

- **Prettier**: Code formatter with configuration in `.prettierrc`
  - Uses tabs, single quotes, 100 char width
  - Svelte and Tailwind CSS plugins enabled
- **ESLint**: Linter with TypeScript and Svelte support
  - Configured in `eslint.config.js`
  - Includes Prettier integration for consistent formatting
- **Style Guidelines**:
  - Use tabs for indentation
  - Single quotes for strings
  - Trailing commas disabled
  - 100 character line width
  - **DaisyUI**: Always prefer DaisyUI components over custom CSS
  - **Tailwind**: Prioritize Tailwind utility classes over custom CSS
  - **Colors**: Use DaisyUI color classes (base-400 available for darker base-300)

## Build and run (dev & prod)

```bash
# Development server with hot reload
pnpm run dev

# Build for production
pnpm run build

# Preview production build
pnpm run preview

# PWA build includes manifest generation
pnpm run build  # Automatically generates PWA assets
```

## Common tasks / common fixes

- **Code Formatting**: Run `pnpm run format` to format all code
- **Type Checking**: Run `pnpm run check` to verify TypeScript types
- **Dependency Updates**: Update packages with `pnpm update`
- **Git Operations**: Use browser-based Git via isomorphic-git in `/lib/dbs/git-manager`
- **Nostr Relays**: Configure relay connections through the application UI
- **Database**: Dexie local database at `/lib/dbs/LocalDb` for offline capability

## CI notes

- **Netlify Deployment**: Configured via `netlify.toml`
  - Build command: `pnpm run build`
  - Publish directory: `build`
  - Custom headers for Nostr JSON and manifest files
- **Static Site Generation**: Uses SvelteKit adapter for static export
- **PWA Support**: Progressive Web App capabilities enabled
- **Nostr Headers**: CORS headers configured for Nostr relay integration

## Files & directories to ignore or preserve

### Ignore

- `node_modules/` - Dependencies
- `.output/`, `.vercel/`, `.netlify/`, `.wrangler/` - Build outputs
- `.svelte-kit/` - SvelteKit build artifacts
- `build/` - Production build output
- `.DS_Store`, `Thumbs.db` - OS files
- `.env`, `.env.*` - Environment files (except examples)
- `vite.config.js.timestamp-*` - Vite cache files
- `.direnv/` - Nix development environment
- `tmp/` - Temporary files
- `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` - Lock files

### Preserve

- `src/` - Source code
- `static/` - Static assets
- `lib/` - Library code with architecture components
- `src/routes/` - SvelteKit routing
- `.prettierrc`, `eslint.config.js` - Configuration files
- `tsconfig.json` - TypeScript configuration
- `vite.config.ts` - Vite configuration
- `svelte.config.js` - Svelte configuration
- `netlify.toml` - Netlify deployment configuration

## Dangerous patterns / forbidden changes

- **Thread Architecture**: Do not modify the separation between internal (main thread) and external (Web Worker) components
- **Query Centre**: Do not bypass the `query-centre` for data access - all UI components must use it
- **Nostr Integration**: Preserve Nostr relay communication patterns in `/lib/relay/`
- **Database Schema**: Avoid modifying Dexie database schema without migration planning
- **Git Operations**: Do not break browser-based Git functionality in `/lib/dbs/git-manager`
- **Processor System**: Maintain the specialized processor architecture in `/lib/processors/`
- **Memory Management**: Preserve the InMemoryRelay cache system for performance

## Testing expectations for PRs

- **Unit Tests**: All new features must include unit tests in `src/**/*.spec.ts`
- **Type Checking**: Must pass TypeScript checking with `pnpm run check`
- **Linting**: Must pass ESLint with `pnpm run lint`
- **Formatting**: Code must be formatted with `pnpm run format`
- **Integration**: Test Nostr relay integration and Git operations
- **PWA**: Verify PWA functionality on mobile devices
- **Performance**: Ensure thread separation maintains UI responsiveness

## Contact / human fallback

- **Repository**: Report issues and see PRs at https://gitworkshop.dev/repo/gitworkshop
- **Sister Project**: Use ngit for PR submissions - https://gitworkshop.dev/ngit
- **Documentation**: Architecture details at https://gitworkshop.dev/about
- **Quick Start**: Getting guide at https://gitworkshop.dev/quick-start
- **Nostr Integration**: Relay-specific documentation in `/lib/relay/`

## Metadata

- **Framework**: Svelte 5, SvelteKit with TypeScript
- **Adapter**: @sveltejs/adapter-static (SPA mode with `ssr: false`)
- **Package Manager**: pnpm (preferred)
- **Build Tool**: Vite
- **Database**: Dexie for client-side storage
- **Git**: isomorphic-git for browser operations
- **Nostr**: applesauce (primary), nostr-tools, nostr-idb for relay integration
- **Styling**: Tailwind CSS with DaisyUI components
- **Rich Text**: Tiptap editor for content composition
- **PWA**: @vite-pwa/sveltekit for progressive web app features

## Progressive Web App (PWA)

### Architecture

GitWorkshop.dev is a fully functional PWA with:
- **Service Worker**: Auto-generated via @vite-pwa/sveltekit
- **Offline Support**: Cached assets and navigation fallback
- **Installable**: Works as standalone app on desktop and mobile
- **Auto-Update**: User notifications when new version available

### Key Configuration

**Adapter** (`svelte.config.js`):
```javascript
import adapter from '@sveltejs/adapter-static';

adapter({
  pages: 'build',
  assets: 'build',
  fallback: 'index.html',  // SPA fallback for offline navigation
  precompress: false,
  strict: true
})
```

**PWA Plugin** (`vite.config.ts`):
```javascript
SvelteKitPWA({
  devOptions: {
    enabled: false  // IMPORTANT: Disabled in dev to avoid importScripts errors
  },
  workbox: {
    globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}', 'index.html'],
    navigateFallback: '/index.html',  // IMPORTANT: Must match precached file
    navigateFallbackDenylist: [/^\/_app\//, /^\/api\//, /\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2)$/]
  }
})
```

**Netlify** (`netlify.toml`):
```toml
# SPA fallback redirect
[[redirects]]
    from = "/*"
    to = "/index.html"
    status = 200
```

### Components

- **`src/lib/components/PwaUpdateNotification.svelte`**: Toast notification for app updates
- **`src/routes/offline/+page.svelte`**: Offline fallback page
- **`static/manifest.json`**: Web app manifest with icons and metadata

### Testing PWA

**DO NOT test in dev mode** (`pnpm run dev`):
- PWA is intentionally disabled
- Avoids `importScripts` errors with workbox files
- Use for normal development only

**DO test in preview mode** (`pnpm run build && pnpm run preview`):
- Full service worker functionality
- Test offline: DevTools → Network → Check "Offline" → Refresh
- Test installation
- Test update notifications

**Production** (Netlify):
- Full PWA features
- Works offline (airplane mode, no WiFi)
- Installable on all platforms

### Critical Files

- `build/index.html` - SPA shell (generated by static adapter)
- `build/sw.js` - Service worker (generated by PWA plugin)
- `build/manifest.json` - Web app manifest (static file)
- `static/icons/*` - PWA icons (all sizes including maskable)

### Caching Strategy

**Precache** (install time):
- All JavaScript bundles
- All CSS files
- All static assets (icons, images)

**Runtime Cache**:
- Fonts: CacheFirst, 365 days
- Images: CacheFirst, 30 days
- Nostr/API: Not cached (always network)

**Navigation**:
- Offline navigation requests → serve `index.html`
- SvelteKit router handles client-side routing

### Common Issues

**Issue**: `NetworkError: Failed to execute 'importScripts'` in dev mode
**Solution**: PWA must be disabled in dev (`devOptions.enabled: false`)

**Issue**: `non-precached-url: non-precached-url :: [{"url":"/"}]`
**Solution**: 
1. Add `index.html` to `globPatterns`: `['client/**/*', 'index.html']`
2. Use `/index.html` not `/` for `navigateFallback`
3. The navigation fallback URL must be in the precache manifest

**Issue**: `ERR_INTERNET_DISCONNECTED` when testing offline
**Solution**: 
1. Use static adapter (not Netlify adapter)
2. Add navigation fallback in workbox config
3. Ensure index.html is precached
4. Test in preview mode, not dev mode

**Issue**: Stopping preview server shows "Site can't be reached"
**Explanation**: This is expected. Browser needs origin to exist. In production, server is always running; it's the network that goes offline, not the server.

### PWA Checklist

Before deploying PWA changes:
- [ ] `devOptions.enabled: false` in vite.config.ts
- [ ] Using `@sveltejs/adapter-static` not `@sveltejs/adapter-netlify`
- [ ] `fallback: 'index.html'` in adapter config
- [ ] `globPatterns` includes `'index.html'` in workbox config
- [ ] `navigateFallback: '/index.html'` in workbox config (must match precached file)
- [ ] SPA redirect in netlify.toml
- [ ] Test in preview mode offline works
- [ ] `build/index.html` exists after build
- [ ] Service worker has NavigationRoute (`grep NavigationRoute build/sw.js`)
- [ ] index.html is precached (`grep 'index\.html' build/sw.js`)

## Svelte 5 Preferences

Good

```
<script type="ts">
  // ✅ Read props via $props (read-only)
  let { count, label }: { count: number; label: string  } = $props();
  // ✅ Local mutable state via $state
  let n = $state(0);
  // ✅ Pure computed values via $derived
  const sum = $derived(() => n + count);
</script>
```

Bad

```
<script>
  // 🚫 exported prop
  export let count = 0;
  // 🚫 Implicit mutable top-level var (not using $state)
  let n = 0;
  function inc() { n += 1; }
  // 🚫 Using $: for pure computed values
  $: sum = n + count;
</script>
```
