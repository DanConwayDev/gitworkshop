<script lang="ts">
	import { extractIssueTitle, extractRepoRefsFromPrOrIssue } from '$lib/git-utils';
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';
	import store from '$lib/store.svelte';
	import { routeToRepoRef, type RepoRouteString, type WebSocketUrl } from '$lib/types';
	import { nip19, type NostrEvent } from 'nostr-tools';

	let { event, relay_hint }: { event: NostrEvent; relay_hint?: WebSocketUrl } = $props();
	let route_a_ref = $derived(routeToRepoRef(store.route));
	let repo_refs = $derived(extractRepoRefsFromPrOrIssue(event));
	let issue_in_selected_repo = $derived(
		route_a_ref && repo_refs.some((r) => r.a_ref === route_a_ref)
	);
	let a_ref = $derived(issue_in_selected_repo ? route_a_ref : (repo_refs[0]?.a_ref ?? undefined));
	let repo_identifier = $derived(a_ref?.split(':')[2] ?? '');

	let link_creator = $derived(a_ref ? new RepoRouteStringCreator(a_ref) : undefined);
	let repo_link: RepoRouteString | undefined = $derived(link_creator ? link_creator.s : undefined);

	let nevent = $derived(
		nip19.neventEncode({
			id: event.id,
			kind: event.kind,
			author: event.pubkey,
			relays: relay_hint ? [relay_hint] : undefined
		})
	);
</script>

<span>
	{#if repo_link}
		Git Issue for <a class="opacity-50" href={`/${repo_link}`}>{repo_identifier}</a>:
		<a href={`/${repo_link}/issues/${nevent}`}>{extractIssueTitle(event)}</a> by
	{:else}
		Git Issue not linked to a repository (badly formatted):
		<a href={`/${nevent}`}>{extractIssueTitle(event)}</a> by
	{/if}
</span>
