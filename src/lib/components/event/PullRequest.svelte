<script lang="ts">
	import 'highlight.js/styles/agate.min.css';
	import { type NostrEvent } from 'nostr-tools';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import { getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import type { CommitInfo } from '$lib/types/git-manager';
	import CommitOneLineSummaries from '../prs/CommitOneLineSummaries.svelte';

	let { event }: { event: NostrEvent } = $props();

	let content = $derived(nostrEventToDocTree(event, true));

	let repo_refs = $derived(
		event.tags.flatMap((s) => (s[0] === 'a' && s[1] !== undefined ? [s[1]] : []))
	);

	let tip_id = $derived(getTagValue(event.tags, 'c') || '[commit_id unknown]');

	let commits: CommitInfo[] | undefined = $state();
	const loadCommitInfos = async (event_id: string, tip_id: string) => {
		const infos = await git_manager.getPrCommitInfos(event_id, tip_id);
		if (infos) commits = infos;
	};
	$effect(() => {
		if (git_manager.a_ref && repo_refs.includes(git_manager.a_ref)) {
			loadCommitInfos($state.snapshot(event.id), $state.snapshot(tip_id));
		} else {
			console.log('here');
		}
	});
	// let tip_id_shorthand = $derived(tip_id.substring(0, 8) || '[commit_id unknown]');
</script>

<div class="">
	<ContentTree node={content} />
	{#if commits && commits.length > 0}
		<CommitOneLineSummaries infos={commits} />
	{/if}
</div>
