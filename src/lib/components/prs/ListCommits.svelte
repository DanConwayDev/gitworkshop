<script lang="ts">
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import { inMemoryRelayTimeline, liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
	import { getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import { onMount } from 'svelte';
	import { PrUpdateKind } from '$lib/kinds';
	import type { CommitInfo } from '$lib/types/git-manager';
	import CommitOneLineSummaries from './CommitOneLineSummaries.svelte';
	let { table_item }: { table_item: IssueOrPRTableItem } = $props();

	let pr_repos = $derived(table_item?.repos ?? []);
	let pr_author = $derived(table_item?.author);
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

	let repo_refs = $derived(table_item.repos);

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
			commits = infos;
			loading = false;
		} else {
			interval_id = setInterval(() => {
				loadCommitInfos(event_id, tip_id);
			}, 100) as unknown as number;
		}
	};

	let pr_or_pr_update_query = $derived(
		inMemoryRelayTimeline([
			{ ids: [table_item.uuid] },
			{ kinds: [PrUpdateKind], '#E': [table_item.uuid] }
		])
	);
	let tip_and_event_id = $derived(
		// the PR event may not be in local relay so supliment with pr_table_item.event
		[...(table_item ? [table_item.event] : []), ...pr_or_pr_update_query.timeline]
			.filter((e) => item_maintainers.includes(e.pubkey))
			.sort((a, b) => b.created_at - a.created_at)
			.map((e) => {
				let tip = getTagValue(e.tags, 'c');
				if (!tip) return undefined;
				return { event_id: e.id, tip };
			})
			.find((e) => !!e)
	);

	onMount(() => {
		if (tip_and_event_id) loadCommitInfos(tip_and_event_id.event_id, tip_and_event_id.tip);
	});
	$effect(() => {
		if (tip_and_event_id) loadCommitInfos(tip_and_event_id.event_id, tip_and_event_id.tip);
	});
</script>

<CommitOneLineSummaries infos={commits} {loading} />
