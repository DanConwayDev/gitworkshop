<script lang="ts">
	import { isRelayCheck, type WebSocketUrl, type WithRelaysInfo } from '$lib/types';
	import FromNow from './FromNow.svelte';

	let { item }: { item: WithRelaysInfo } = $props();
</script>

<ul>
	{#each Object.keys(item.relays_info) as relay (relay)}
		<li>
			{relay}
			{item.relays_info[relay as WebSocketUrl].score}
			{#each item.relays_info[relay as WebSocketUrl].huristics.filter(isRelayCheck) as huristic, i (`${i}${huristic.type}${huristic.timestamp}`)}
				{huristic.type}
				<FromNow unix_seconds={huristic.timestamp} />
			{/each}
		</li>
	{/each}
</ul>
