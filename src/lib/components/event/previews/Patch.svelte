<script lang="ts">
	import {
		extractPatchMessage,
		extractPatchTitle,
		extractRepoRefsFromPrOrIssue
	} from '$lib/git-utils';
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';
	import store from '$lib/store.svelte';
	import {
		isEventIdString,
		routeToRepoRef,
		type RepoRouteString,
		type WebSocketUrl
	} from '$lib/types';
	import { eventIsPrRoot, getRootUuid } from '$lib/utils';
	import { getTagValue } from 'applesauce-core/helpers';
	import { nip19, type NostrEvent } from 'nostr-tools';

	let { event, relay_hint }: { event: NostrEvent; relay_hint?: WebSocketUrl } = $props();
	let route_a_ref = $derived(routeToRepoRef(store.route));
	let repo_refs = $derived(extractRepoRefsFromPrOrIssue(event));
	let patch_in_selected_repo = $derived(
		route_a_ref && repo_refs.some((r) => r.a_ref === route_a_ref)
	);

	let commit_message = $derived(
		getTagValue(event, 'description') || extractPatchMessage(event.content) || '[untitled]'
	);
	let commit_title = $derived(commit_message.split('\n')[0]);

	let a_ref = $derived(patch_in_selected_repo ? route_a_ref : (repo_refs[0]?.a_ref ?? undefined));
	let repo_identifier = $derived(a_ref?.split(':')[2] ?? '');

	let link_creator = $derived(a_ref ? new RepoRouteStringCreator(a_ref) : undefined);
	let repo_link: RepoRouteString | undefined = $derived(link_creator ? link_creator.s : undefined);

	let patch_is_pr = $derived(eventIsPrRoot(event));
	let patch_or_pr = $derived(patch_is_pr ? 'PR' : 'Patch');
	let pr_root_id = $derived(patch_is_pr ? getRootUuid(event) : undefined);
	let pr_nevent = $derived(
		pr_root_id && isEventIdString(pr_root_id)
			? nip19.neventEncode({
					id: pr_root_id
				})
			: undefined
	);

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
		Git {patch_or_pr} for <a class="opacity-50" href={`/${repo_link}`}>{repo_identifier}</a>:
		<a href={`/${repo_link}/prs/${pr_nevent ? `${pr_nevent}#` : ''}${nevent}`}
			>{extractPatchTitle(event)}</a
		> by
	{:else}
		Git {patch_or_pr} not linked to a repository (badly formatted):
		<a href={`/${nevent}`}>{commit_title}</a> by
	{/if}
</span>
