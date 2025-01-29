<script lang="ts">
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';
	import { type RepoRouteString } from '$lib/types';
	import { getTagValue } from '$lib/utils';
	import { type NostrEvent } from 'nostr-tools';

	let { event }: { event: NostrEvent } = $props();

	let link_creator = new RepoRouteStringCreator(
		`${event.kind}:${event.pubkey}:${getTagValue(event.tags, 'd')}`
	);
	let repo_link: RepoRouteString | undefined = $derived(link_creator ? link_creator.s : undefined);
</script>

<span>
	{#if repo_link}
		Git Repository: <a href={`/${repo_link}`}>{getTagValue(event.tags, 'd')}</a> by
	{/if}
</span>
