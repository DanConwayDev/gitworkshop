// Tombstone service worker — unregisters any previously installed SW and
// clears all caches left by the old gitworkshop codebase.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", async () => {
  // Delete all caches from the old SW
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));

  // Unregister this SW so future loads are fully uncontrolled
  await self.registration.unregister();

  // Take control of any open clients so they see clean network requests
  await clients.claim();
});
