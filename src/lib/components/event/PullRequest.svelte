<script lang="ts">
	import 'highlight.js/styles/agate.min.css';
	import { type NostrEvent } from 'nostr-tools';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import { getTagMultiValue, getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import { type CommitInfo } from '$lib/types/git-manager';
	import { onMount } from 'svelte';
	import CommitsDetails from '../prs/CommitsDetails.svelte';

	let { event }: { event: NostrEvent } = $props();

	function moreThan20LiteralBackslashN(s: string) {
		let start = 0,
			idx,
			count = 0;
		while ((idx = s.indexOf('\\n', start)) !== -1) {
			if (++count > 20) return true;
			start = idx + 2;
		}
		return false;
	}
	let content = $derived(
		moreThan20LiteralBackslashN(event.content) // probably done by mistake
			? // added specifically because I created note18hh0lk6grnwljd6y73qgwvmcagtwwnz6n0pvv5jvcxzenszh5t3saer2py via `ngit send`
				nostrEventToDocTree(
					{
						content: event.content.replace(/\\n/g, '\n'),
						tags: []
					} as unknown as NostrEvent,
					true
				)
			: nostrEventToDocTree(event, true)
	);
	let repo_refs = $derived(
		event.tags.flatMap((s) => (s[0] === 'a' && s[1] !== undefined ? [s[1]] : []))
	);

	let tip_id = $derived(getTagValue(event.tags, 'c') || '[commit_id unknown]');
	let extra_clone_urls = $derived(getTagMultiValue(event.tags, 'clone') || []);

	let commits: CommitInfo[] | undefined = $state();
	let interval_id = $state<number | undefined>();
	let loading: boolean = $state(true);
	const loadCommitInfos = async (event_id: string, tip_id: string, extra_clone_urls: string[]) => {
		if (interval_id) clearInterval(interval_id);
		if (git_manager.a_ref && repo_refs.includes(git_manager.a_ref)) {
			const infos = await git_manager.getPrCommitInfos({
				event_id_listing_tip: $state.snapshot(event_id),
				tip_commit_id: $state.snapshot(tip_id),
				extra_clone_urls: $state.snapshot(extra_clone_urls)
			});
			if (infos) commits = infos;
			loading = false;
		} else {
			interval_id = setInterval(() => {
				loadCommitInfos(event_id, tip_id, extra_clone_urls);
			}, 100) as unknown as number;
		}
	};
	onMount(() => {
		loadCommitInfos(event.id, tip_id, extra_clone_urls);
	});
	// let tip_id_shorthand = $derived(tip_id.substring(0, 8) || '[commit_id unknown]');
	const sub_filter = $derived(['explorer', tip_id]);
	const clone_urls = $derived([...(git_manager.clone_urls ?? []), ...extra_clone_urls]);
</script>

<div class="">
	<ContentTree node={content} />
	<CommitsDetails infos={commits} {loading} {clone_urls} {sub_filter} />
</div>
