<script lang="ts">
	import { extractIssueTitle, extractRepoRefsFromPrOrIssue } from '$lib/git-utils';
	import store from '$lib/store.svelte';
	import { repoRefToPubkeyLink } from '$lib/utils';
	import { nip19, type NostrEvent } from 'nostr-tools';

	let { event }: { event: NostrEvent } = $props();
	let repo_refs = $derived(extractRepoRefsFromPrOrIssue(event));
	let issue_in_selected_repo = $derived(
		store.selected_a_ref && repo_refs.some((r) => r.a_ref === store.selected_a_ref)
	);
	let a_ref = $derived(
		issue_in_selected_repo ? store.selected_a_ref : (repo_refs[0]?.a_ref ?? undefined)
	);
	let repo_identifier = $derived(a_ref?.split(':')[2] ?? '');

	let repo_link = $derived(
		issue_in_selected_repo ? store.repo_route?.s : a_ref ? repoRefToPubkeyLink(a_ref) : undefined
	);
</script>

<div>
	{#if repo_link}
		Git Issue for <a class="opacity-50" href={`/${repo_link}`}>{repo_identifier}</a>:
		<a href={`/${repo_link}/issues/${nip19.noteEncode(event.id)}`}>{extractIssueTitle(event)}</a> by
	{:else}
		Git Issue not linked to a repository (badly formatted):
		<a href={`/${repo_link}/issues/${nip19.noteEncode(event.id)}`}>{extractIssueTitle(event)}</a> by
	{/if}
</div>
