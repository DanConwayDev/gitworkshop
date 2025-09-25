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
- **Adapter**: Netlify static adapter
- **Package Manager**: pnpm (preferred)
- **Build Tool**: Vite
- **Database**: Dexie for client-side storage
- **Git**: isomorphic-git for browser operations
- **Nostr**: applesauce (primary), nostr-tools, nostr-idb for relay integration
- **Styling**: Tailwind CSS with DaisyUI components
- **Rich Text**: Tiptap editor for content composition
- **PWA**: @vite-pwa/sveltekit for progressive web app features

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
