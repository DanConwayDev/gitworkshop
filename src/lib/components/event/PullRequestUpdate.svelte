<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
	import { getTagValue } from '$lib/utils';
	import { icons_misc } from '$lib/icons';
	import git_manager from '$lib/git-manager';
	import type { CommitInfo } from '$lib/types/git-manager';
	import CommitOneLineSummaries from '../prs/CommitOneLineSummaries.svelte';
	import { onMount } from 'svelte';
	let {
		event,
		issue_or_pr_table_item
	}: { event: NostrEvent; issue_or_pr_table_item?: IssueOrPRTableItem } = $props();

	let item_maintainers_query = $derived(
		liveQueryState(async () => {
			let a_refs = issue_or_pr_table_item?.repos ?? [];
			let items = await db.repos.bulkGet(a_refs);
			let maintainers: PubKeyString[] = [];
			items.forEach((item) => item?.maintainers?.forEach((m) => maintainers.push(m)));
			return [issue_or_pr_table_item?.author, ...maintainers];
		})
	);
	let item_maintainers = $derived(
		item_maintainers_query.current ?? [issue_or_pr_table_item?.author]
	);
	let with_permission = $derived(item_maintainers.includes(event.pubkey));

	let tip_id = $derived(getTagValue(event.tags, 'c') || '[commit_id unknown]');
	let tip_id_shorthand = $derived(tip_id.substring(0, 8) || '[commit_id unknown]');

	let repo_refs = $derived(
		event.tags.flatMap((s) => (s[0] === 'a' && s[1] !== undefined ? [s[1]] : []))
	);

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
</script>

{#snippet commitInfos()}
	<div class="md:ml-10">
		{#if loading}
			loading
		{:else if commits && commits.length > 0}
			<CommitOneLineSummaries infos={commits} />
		{:else}
			couldnt load commits
		{/if}
	</div>
{/snippet}

<EventWrapperLite {event} name_first children_below={commitInfos}>
	<span class="text-sm">
		{#if with_permission}pushed PR updates
		{:else}suggested pr updates
		{/if}
	</span>
</EventWrapperLite>
