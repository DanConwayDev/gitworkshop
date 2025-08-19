<script lang="ts">
	import UserHeader from '$lib/components/user/UserHeader.svelte';
	import type { PubKeyString } from '$lib/types';

	let {
		items,
		callback
	}: {
		items: { pubkey: PubKeyString; query: string }[];
		callback: (o: { pubkey: PubKeyString; query: string }) => void;
	} = $props();

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
				callback(items[activeIdx]);
				return true;
		}

		return false;
	}
</script>

<div class="border-neutral bg-base-300 max-w-lg rounded">
	{#each items as item, i}
		<button
			class="w-full items-center text-left"
			class:bg-base-400={i === activeIdx}
			onclick={() => callback(items[activeIdx])}
		>
			<UserHeader inline user={item.pubkey} link_to_profile={false} />
		</button>
	{/each}
</div>
