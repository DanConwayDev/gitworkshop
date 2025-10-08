<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { inMemoryRelayTimeline, liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
	import { getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import type { CommitInfo } from '$lib/types/git-manager';
	import CommitOneLineSummaries from '../prs/CommitOneLineSummaries.svelte';
	import { onMount } from 'svelte';
	import { PrUpdateKind } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	let {
		event,
		issue_or_pr_table_item
	}: { event: NostrEvent; issue_or_pr_table_item?: IssueOrPRTableItem } = $props();

	let pr_event_id: string | undefined = $derived(getTagValue(event.tags, 'E'));

	let pr_table_item_query = $derived(pr_event_id ? query_centre.fetchPr(pr_event_id) : undefined);
	let pr_table_item = $derived(pr_table_item_query ? pr_table_item_query.current : undefined);

	let pr_repos = $derived(pr_table_item?.repos ?? []);
	let pr_author = $derived(pr_table_item?.author);
	let item_maintainers_query = $derived(
		liveQueryState(
			async () => {
				let a_refs = pr_repos;
				let items = await db.repos.bulkGet(a_refs);
				let maintainers: PubKeyString[] = [];
				items.forEach((item) => item?.maintainers?.forEach((m) => maintainers.push(m)));
				return [...(pr_author ? [pr_author] : []), ...maintainers];
			},
			() => [pr_repos, pr_author]
		)
	);
	let item_maintainers = $derived(item_maintainers_query.current ?? []);
	let with_permission = $derived(item_maintainers.includes(event.pubkey));

	let tip_id = $derived(getTagValue(event.tags, 'c') || '[commit_id unknown]');

	let repo_refs = $derived(
		event.tags.flatMap((s) => (s[0] === 'a' && s[1] !== undefined ? [s[1]] : []))
	);

	let commits_on_branch: CommitInfo[] | undefined = $state();
	let interval_id = $state<number | undefined>();
	let loading: boolean = $state(true);
	const loadCommitInfos = async (event_id: string, tip_id: string) => {
		if (interval_id) clearInterval(interval_id);
		if (git_manager.a_ref && repo_refs.includes(git_manager.a_ref)) {
			const infos = await git_manager.getPrCommitInfos(
				$state.snapshot(event_id),
				$state.snapshot(tip_id)
			);
			if (infos) commits_on_branch = infos;
			loading = false;
		} else {
			interval_id = setInterval(() => {
				loadCommitInfos(event_id, tip_id);
			}, 100) as unknown as number;
		}
	};

	let previous_tip_query = $derived(
		pr_event_id
			? inMemoryRelayTimeline([
					{ ids: [pr_event_id] },
					{ kinds: [PrUpdateKind], '#E': [pr_event_id] }
				])
			: { timeline: [] }
	);
	let previous_tip = $derived(
		// the PR event may not be in local relay so supliment with pr_table_item.event
		[...(pr_table_item ? [pr_table_item.event] : []), ...previous_tip_query.timeline]
			.filter((e) => item_maintainers.includes(e.pubkey) && e.created_at < event.created_at)
			.sort((a, b) => a.created_at - b.created_at)
			.map((e) => getTagValue(e.tags, 'c'))
			.find((e) => !!e)
	);

	let new_commits = $derived.by(() => {
		if (!commits_on_branch || !previous_tip) return commits_on_branch;
		const idx = commits_on_branch.findIndex((c) => c && c.oid === previous_tip);
		return idx === -1 ? commits_on_branch : commits_on_branch.slice(idx + 1);
	});

	onMount(() => {
		loadCommitInfos(event.id, tip_id);
	});
</script>

{#snippet commitInfos()}
	<div class="md:ml-10">
		<CommitOneLineSummaries infos={new_commits} {loading} />
	</div>
{/snippet}
<EventWrapperLite {event} name_first children_below={commitInfos}>
	<span class="text-sm">
		{#if with_permission}pushed PR updates
		{:else}suggested pr updates
		{/if}
	</span>
</EventWrapperLite>
