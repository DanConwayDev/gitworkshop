<script lang="ts">
	import 'highlight.js/styles/agate.min.css';
	import { type NostrEvent } from 'nostr-tools';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import { getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import type { CommitInfo } from '$lib/types/git-manager';
	import CommitOneLineSummaries from '../prs/CommitOneLineSummaries.svelte';
	import { onMount } from 'svelte';

	let { event }: { event: NostrEvent } = $props();

	let content = $derived(nostrEventToDocTree(event, true));

	let repo_refs = $derived(
		event.tags.flatMap((s) => (s[0] === 'a' && s[1] !== undefined ? [s[1]] : []))
	);

	let tip_id = $derived(getTagValue(event.tags, 'c') || '[commit_id unknown]');

	let commits: CommitInfo[] | undefined = $state();
	let interval_id = $state<number | undefined>();
	let loading: boolean = $state(true);
	const loadCommitInfos = async (event_id: string, tip_id: string) => {
		if (interval_id) clearInterval(interval_id);
		if (git_manager.a_ref && repo_refs.includes(git_manager.a_ref)) {
			const infos = await git_manager.getPrCommitInfos(
				$state.snapshot(event_id),
				$state.snapshot(tip_id)
			);
			if (infos) commits = infos;
			loading = false;
		} else {
			interval_id = setInterval(() => {
				loadCommitInfos(event_id, tip_id);
			}, 100) as unknown as number;
		}
	};

	onMount(() => {
		loadCommitInfos(event.id, tip_id);
	});
	// let tip_id_shorthand = $derived(tip_id.substring(0, 8) || '[commit_id unknown]');
</script>

<div class="">
	<ContentTree node={content} />
	<CommitOneLineSummaries infos={commits} {loading} />
</div>
