import NDKSvelte from '@nostr-dev-kit/ndk-svelte';

export const ndk = new NDKSvelte({
    explicitRelayUrls: ['ws://localhost:8080'],
});

ndk.connect();
