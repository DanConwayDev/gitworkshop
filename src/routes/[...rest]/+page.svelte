<script lang="ts">
	import { goto } from '$app/navigation';
	import ContainerCenterPage from '$lib/components/ContainerCenterPage.svelte';
	import NotFound404Page from '$lib/components/NotFound404Page.svelte';
	import { extractRepoRefsFromPrOrIssue } from '$lib/git-utils';
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';
	import { Issue } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { EventIdString, Nevent, Nnote, RepoRef } from '$lib/types';
	import { eventIsPrRoot } from '$lib/utils';
	import { nip19 } from 'nostr-tools';

	let { data }: {data: {rest: string}} = $props();
	
	let event_ref = $derived(data.rest.split('/')[0]);
	let decoded = $derived.by(() => {
		try {
			let d = nip19.decode(event_ref)
			if (d.type === 'nevent' || d.type === 'note' || d.type === 'naddr') return d;
		} catch {}
		return undefined

	});

	let pointer = $derived(decoded?.type === 'nevent' ? decoded.data : decoded?.type === 'note' ? {id: decoded.data} : undefined);

	let pr_query = $derived(pointer ? query_centre.fetchPr(pointer.id) : undefined);
	let issue_query = $derived(pointer ? query_centre.fetchIssue(pointer.id) : undefined);
	let event_query = $derived(pointer ? query_centre.fetchEvent(pointer) : undefined);

	const routeToEvent = (bech32: Nevent | Nnote, a_ref: RepoRef, type: 'pr' | 'issue'): 'pr'| 'issue' => {
		goto(`/${new RepoRouteStringCreator(a_ref).s}/${type}s/${bech32}`);
		return type
	};
	let event_type: 'issue'| 'pr'| 'other' | undefined = $derived.by(() => {
		if (pr_query?.current) return routeToEvent(event_ref as Nevent,pr_query?.current.repos[0], 'pr');
		if (issue_query?.current) return routeToEvent(event_ref as Nevent,issue_query?.current.repos[0], 'issue');
		const isnt_issue_or_pr_root = event_query?.event && !eventIsPrRoot(event_query.event) && (event_query.event.kind !== Issue);
		if (isnt_issue_or_pr_root) return 'other'
		return undefined;
		// if (event_query?.event && (eventIsPrRoot(event_query.event) || event_query.event.kind === Issue)) {
		// 	const type = event_query.event.kind === Issue ? 'issue' : 'pr';
		// 	let repo_refs = extractRepoRefsFromPrOrIssue(event_query.event);
		// 	if (repo_refs.length > 0) {
		// 		goto(`/${new RepoRouteStringCreator(repo_refs[0].a_ref).s}/${type}s/${event_ref}`);
		// 		return type
		// 	} else {
		// 		// TODO display error - poorly formattted pr / issue
		// 	}
		// }
	});

	// TODO redirect repo state announcements
</script>

<svelte:head>
	<title>gitworkshop.dev</title>
</svelte:head>


{#snippet loadingContainer(text: string)}
	<ContainerCenterPage>
		<div class="py-9 text-center">
			<span class="loading loading-spinner loading-lg mb-4 color-neutral-content opacity-25"></span>
			<div class="text-neutral-content">{text}</div>
		</div>
	</ContainerCenterPage>

{/snippet}

{#if !decoded}
	<NotFound404Page />
{:else if decoded.type === 'naddr'}
	<NotFound404Page msg="gitworkshop.dev doesnt no how to redirect naddr urls that arn't Git Repository Announcement event" />
{:else if event_type}
	{#if event_type === 'other'}
		<!-- {@render loadingContainer(`found event - fetching context`)} -->
		<NotFound404Page msg="TODO: You have probably followed a link to a comment on a PR or Issue. Give us a nudge to build the routing for this!" />
		<!-- TODO build routing  -->
	{:else}
		{@render loadingContainer(`routing to ${event_type} page`)}
	{/if}
<!-- TODO not related to a git event - show event  -->
{:else}
	{@render loadingContainer(`searching relays for event ${event_ref}`)}
{/if}
<!-- TODO event not found - show relays searched  -->

