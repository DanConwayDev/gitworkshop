# PWA Configuration - Critical Documentation

**Status**: ✅ WORKING in all modes (pnpm preview, npx serve, Netlify production)  
**Last Updated**: 2025-10-23  
**Warning**: Read this ENTIRE document before modifying PWA configuration!

## Working Configuration Summary

The PWA is configured with these critical settings in [`vite.config.ts`](../vite.config.ts):

```typescript
workbox: {
  globDirectory: '.svelte-kit/output/client',  // NOT 'build'!
  globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,json}'],
  additionalManifestEntries: [
    { url: '/', revision: null },
    { url: 'index.html', revision: null }
  ],
  navigateFallback: '/',
  skipWaiting: true,
  clientsClaim: true
}
```

## Why This Configuration Works

### 1. `globDirectory: '.svelte-kit/output/client'` (CRITICAL!)

**DO NOT change this to `'build'`!**

**Why `.svelte-kit/output/client` is required:**

- The PWA plugin runs DURING the build process
- At that time, `.svelte-kit/output/client` exists with all compiled assets
- The final `build/` directory is created AFTER by the static adapter
- If we use `'build'`, the precache will be EMPTY (0 files)

**What happens:**

1. SvelteKit compiles → creates `.svelte-kit/output/client/` with all JS/CSS
2. PWA plugin scans `.svelte-kit/output/client/` → generates precache manifest
3. Static adapter copies to `build/` → includes the generated service worker
4. Result: Service worker has correct file references

### 2. `additionalManifestEntries` (REQUIRED!)

```typescript
additionalManifestEntries: [
	{ url: '/', revision: null },
	{ url: 'index.html', revision: null }
];
```

**Why these entries are needed:**

- Workbox precaches `index.html` from the scan
- But navigation requests come in as `/` (root URL)
- We need BOTH entries to ensure navigation fallback works
- Without this: offline navigation fails with `non-precached-url` errors

### 3. `skipWaiting: true` and `clientsClaim: true` (REQUIRED!)

```typescript
skipWaiting: true,      // Activate new SW immediately
clientsClaim: true      // Take control of pages immediately
```

**Why these are critical:**

- Service workers don't intercept the very first page load by default
- `skipWaiting` makes new service worker activate immediately
- `clientsClaim` makes it control all pages right away
- Without these: hard refresh while offline fails with `ERR_INTERNET_DISCONNECTED`

## Tested and Working Scenarios

### ✅ Local Development (pnpm run preview)

- Build generates 109+ precache entries
- Service worker activates correctly
- Offline navigation works
- Client-side routing works offline

### ✅ Local Testing (npx serve build -s)

- SPA fallback works correctly
- All assets cached properly
- Full offline functionality
- Accurate production simulation

### ✅ Production (Netlify)

- Deployed service worker has all files
- Workbox runtime file (`workbox-*.js`) included
- Hard refresh while offline serves cached content
- Complete PWA functionality

## What NOT to Do

### ❌ DON'T Change `globDirectory` to `'build'`

- Results in EMPTY precache (0 files)
- PWA will appear to work online but fail offline
- Cache will only contain manually added entries

### ❌ DON'T Remove `additionalManifestEntries`

- Navigation fallback won't find `/` URL
- Offline hard refresh will fail
- Only clicking links will work offline

### ❌ DON'T Remove `skipWaiting` or `clientsClaim`

- Service worker won't control pages immediately
- First visit while offline will fail
- Requires multiple visits to activate

### ❌ DON'T Add Conflicting Manual Entries

- Don't manually add files that glob patterns will find
- Creates `add-to-cache-list-conflicting-entries` errors
- Breaks the entire precaching system

## Common Mistakes (Lessons Learned)

### Mistake #1: Using `globDirectory: 'build'`

**Problem**: Empty precache because `build/` doesn't exist when PWA plugin runs  
**Symptom**: Build shows "precache 0 entries"  
**Solution**: Use `.svelte-kit/output/client`

### Mistake #2: Removing Manual Entries

**Problem**: Navigation fallback URL doesn't match precache  
**Symptom**: `non-precached-url: [{"url":"/"}]` error  
**Solution**: Keep `additionalManifestEntries` with `/` and `index.html`

### Mistake #3: Missing Service Worker Activation

**Problem**: SW doesn't control pages on first visit  
**Symptom**: Hard refresh offline shows `ERR_INTERNET_DISCONNECTED`  
**Solution**: Add `skipWaiting: true` and `clientsClaim: true`

### Mistake #4: Adding Duplicate Entries

**Problem**: Manual entries conflict with glob pattern findings  
**Symptom**: `add-to-cache-list-conflicting-entries` error, cache broken  
**Solution**: Only add URLs that glob WON'T find (like `/` mapping)

## Testing Checklist

Before deploying PWA changes, verify:

1. **Build Output**

   ```bash
   pnpm run build
   ```

   - Should show "precache 109+ entries (3000+ KiB)"
   - NOT "precache 0 entries"

2. **Service Worker Files**

   ```bash
   ls -la build/sw.js build/workbox-*.js
   ```

   - Both files should exist
   - `sw.js` should be ~8KB
   - `workbox-*.js` should be ~50KB

3. **Local Testing**

   ```bash
   npx serve build -s
   ```

   - Visit site while online
   - Check DevTools → Application → Cache Storage
   - Should see 109+ cached files
   - Go offline, hard refresh → should work

4. **Netlify Testing**
   - Deploy to preview branch
   - Unregister old service worker
   - Clear cache
   - Visit site, let SW install
   - Go offline, hard refresh → should work

## Quick Reference

**Current working config**: [`vite.config.ts`](../vite.config.ts) lines 24-42

**If PWA breaks**, check:

1. Is `globDirectory` set to `.svelte-kit/output/client`?
2. Are `additionalManifestEntries` present with `/` and `index.html`?
3. Are `skipWaiting` and `clientsClaim` set to `true`?
4. Does build show 100+ precache entries?

**Related documentation**:

- [PWA Attempts Summary](../PWA_ATTEMPTS_SUMMARY.md) - All failed attempts
- [PWA Build Timing Issue](../PWA_BUILD_TIMING_ISSUE.md) - Local vs production differences
- [AGENTS.md](../AGENTS.md) - Project conventions

## Emergency Rollback

If PWA breaks after changes:

```typescript
// Restore this exact configuration in vite.config.ts:
workbox: {
  globDirectory: '.svelte-kit/output/client',
  globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,json}'],
  additionalManifestEntries: [
    { url: '/', revision: null },
    { url: 'index.html', revision: null }
  ],
  navigateFallback: '/',
  navigateFallbackDenylist: [
    /^\/api\//,
    /\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2)$/
  ],
  skipWaiting: true,
  clientsClaim: true
}
```

This configuration is PROVEN to work. Don't modify unless absolutely necessary!
