import NDKSvelte from '@nostr-dev-kit/ndk-svelte'

// export let base_relays = import.meta.env.DEV
//   ? ["ws://localhost:8080"]
//   : [

export const base_relays = [
  'wss://relay.f7z.io',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://purplerelay.com', // reliability untested
  // 'wss://relayable.org', // free but not so reliable
]

// TODO: fallback_relays for if profile cannot be found

export const ndk = new NDKSvelte({
  explicitRelayUrls: [...base_relays],
})

ndk.connect(5000)
