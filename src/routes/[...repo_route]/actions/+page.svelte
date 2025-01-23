<script lang="ts">
	import UserHeader from '$lib/components/user/UserHeader.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { RepoRef, RepoRouteData } from '$lib/types';
	import { repoRouteToARef } from '$lib/utils';

	let { data }: { data: RepoRouteData } = $props();

	let { repo_route } = data;
	let nip05_query =
		repo_route.type === 'nip05' ? query_centre.fetchNip05(repo_route.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);
	let a_ref: RepoRef | undefined = $derived(repoRouteToARef(repo_route, nip05_result));
	// the above lines are required to extract the RepoRef from the page route

	// below is the basic pattern to get an array of events based on a nostr filter.
	// `actions_events` is a svelt 5 $state so it is dynamtically updated.
	// query_centre.fetchActions() returns the state from the InMemoryRelay after
	// initiating a request to the QueryCentreExternal to populate the InMemoryRelay
	// with events found on in the local cache and on external relays.
	let actions_query = $derived(a_ref ? query_centre.fetchActions(a_ref) : undefined);
	let actions_events = $derived(actions_query ? actions_query.timeline : []);
</script>

<div>{a_ref}</div>
{#each actions_events as event}
	<div>
		<UserHeader user={event.pubkey} />
		<div>{event.content}</div>
	</div>
{/each}
