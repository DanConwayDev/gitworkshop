<script lang="ts">
	import UserHeader from '$lib/components/user/UserHeader.svelte';
	import { npubEncode } from 'nostr-tools/nip19';

	let { items, callback }: { items: string; callback: (s: string) => void } = $props();

	let activeIdx = $state(0);

	export function onKeyDown(event: KeyboardEvent) {
		if (event.repeat) {
			return;
		}
		switch (event.key) {
			case 'ArrowUp':
				activeIdx = (activeIdx + items.length - 1) % items.length;
				return true;
			case 'ArrowDown':
				activeIdx = (activeIdx + 1) % items.length;
				return true;
			case 'Enter':
				callback(npubEncode(items[activeIdx]));
				return true;
		}

		return false;
	}
</script>

<div class="max-w-lg rounded border-neutral bg-base-300">
	{#each items as item, i}
		<button
			class="w-full items-center text-left"
			class:bg-base-400={i === activeIdx}
			onclick={() => callback(npubEncode(items[activeIdx]))}
		>
			<UserHeader inline user={item} link_to_profile={false} />
		</button>
	{/each}
</div>
