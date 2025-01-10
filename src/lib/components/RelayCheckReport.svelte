<script lang="ts">
	import { isRelayCheck, type WebSocketUrl, type WithRelaysInfo } from '$lib/types';

	let { item }: { item: WithRelaysInfo } = $props();
</script>

<ul>
	{#each Object.keys(item.relays_info) as relay}
		<li>
			{relay}
			{item.relays_info[relay as WebSocketUrl].score}
			{#each item.relays_info[relay as WebSocketUrl].huristics.filter(isRelayCheck) as huristic}
				{huristic.type}
			{/each}
		</li>
	{/each}
</ul>
