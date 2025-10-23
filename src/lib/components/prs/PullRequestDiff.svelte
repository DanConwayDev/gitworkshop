<script lang="ts">
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import { inMemoryRelayTimeline, liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
	import { getTagMultiValue, getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import store from '$lib/store.svelte';
	import { onMount } from 'svelte';
	import { PrUpdateKind } from '$lib/kinds';
	import ChangesToFiles from '../explorer/ChangesToFiles.svelte';
	import { getGitLog } from '$lib/git-utils';
	import AlertWarning from '../AlertWarning.svelte';
	import GitFetchingStatus from '../GitFetchingStatus.svelte';

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

	let diff: string | undefined = $state();
	let interval_id = $state<number | undefined>();
	let loading: boolean = $state(true);
	const loadDiff = async (event_id: string, tip_id: string, extra_clone_urls: string[]) => {
		if (interval_id) clearInterval(interval_id);
		if (git_manager.a_ref && repo_refs.includes(git_manager.a_ref)) {
			const git_diff = await git_manager.getPrDiff({
				event_id_listing_tip: $state.snapshot(event_id),
				tip_commit_id: $state.snapshot(tip_id),
				extra_clone_urls: $state.snapshot(extra_clone_urls)
			});
			diff = git_diff;
			loading = false;
		} else {
			interval_id = setInterval(() => {
				loadDiff(event_id, tip_id, extra_clone_urls);
			}, 100) as unknown as number;
		}
	};

	let pr_or_pr_update_query = $derived(
		inMemoryRelayTimeline([
			{ ids: [table_item.uuid] },
			{ kinds: [PrUpdateKind], '#E': [table_item.uuid] }
		])
	);
	let tip_details = $derived(
		// the PR event may not be in local relay so supliment with pr_table_item.event
		[...(table_item ? [table_item.event] : []), ...pr_or_pr_update_query.timeline]
			.filter((e) => item_maintainers.includes(e.pubkey))
			.sort((a, b) => b.created_at - a.created_at)
			.map((e) => {
				let tip = getTagValue(e.tags, 'c');
				if (!tip) return undefined;
				let extra_clone_urls = getTagMultiValue(e.tags, 'clone') || [];
				return { event_id: e.id, tip, extra_clone_urls };
			})
			.find((e) => !!e)
	);

	onMount(() => {
		if (tip_details) loadDiff(tip_details.event_id, tip_details.tip, tip_details.extra_clone_urls);
	});
	$effect(() => {
		if (tip_details) loadDiff(tip_details.event_id, tip_details.tip, tip_details.extra_clone_urls);
	});

	let waited = $state(false);
	onMount(() => {
		setTimeout(() => {
			waited = true;
		}, 3000);
	});

	let clone_urls = $derived([
		...(git_manager.clone_urls ?? []),
		...(tip_details ? tip_details.extra_clone_urls : [])
	]);
	let sub_filter = $derived(tip_details ? ['explorer', tip_details.tip] : ['explorer']);

	let git_status = $derived(getGitLog(store.git_log, sub_filter));
</script>

{#if diff && diff.length > 0}
	{#if git_status && git_status.level === 'warning'}
		<div class="mb-4">
			<AlertWarning mt={4}>
				<div>{git_status.msg}</div>
			</AlertWarning>
		</div>
	{/if}
	<div class="flex w-full rounded-t p-2">
		<ChangesToFiles {diff} />
	</div>
{:else}
	<div class="relative py-2">
		<GitFetchingStatus
			loading={loading || !waited}
			{waited}
			git_log={store.git_log}
			{sub_filter}
			{clone_urls}
			commits_or_diffs={diff ? [diff] : undefined}
			errorMessage="Error: cannot find PR commit data"
		/>
	</div>
{/if}
