<script lang="ts">
	import { inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import { createActionsRequestFilter } from '$lib/relay/filters/actions';
	import type { EventIdString } from '$lib/types';

	let { request_id }: { request_id: EventIdString } = $props();

	let responses_query = $derived(
		inMemoryRelayTimeline(createActionsRequestFilter(request_id), () => [request_id])
	);
	let responses = $derived(responses_query.timeline);
</script>

<div class="">
	{request_id} -{#each responses as response}
		{response.id},{/each}
</div>
