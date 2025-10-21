<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import type { PubKeyString } from '$lib/types';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { inMemoryRelayTimeline, liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
	import { getTagMultiValue, getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import {
		type CommitInfo,
		type GitManagerLogEntry,
		type GitManagerLogEntryGlobal,
		type GitServerStatus
	} from '$lib/types/git-manager';
	import { onMount } from 'svelte';
	import { PrUpdateKind } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import EventWrapper from './EventWrapper.svelte';
	import CommitsDetails from '../prs/CommitsDetails.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { onLogUpdateGitStatus, onLogUpdateServerStatus } from '$lib/git-utils';

	let { event }: { event: NostrEvent } = $props();

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
	let extra_clone_urls = $derived(getTagMultiValue(event.tags, 'clone') || []);

	let repo_refs = $derived(
		event.tags.flatMap((s) => (s[0] === 'a' && s[1] !== undefined ? [s[1]] : []))
	);

	let commits_on_branch: CommitInfo[] | undefined = $state();
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
			if (infos) commits_on_branch = infos;
			loading = false;
		} else {
			interval_id = setInterval(() => {
				loadCommitInfos(event_id, tip_id, extra_clone_urls);
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

	let waited = $state(false); // avoid flashing incorrect !with_permission messages
	onMount(() => {
		setTimeout(() => (waited = true), 2000);
		loadCommitInfos(event.id, tip_id, extra_clone_urls);
	});
	let server_status: SvelteMap<string, GitServerStatus> = new SvelteMap();
	const log_subs = $derived(['explorer', tip_id]);
	const clone_urls = $derived([...(git_manager.clone_urls ?? []), ...extra_clone_urls]);
	let git_status: GitManagerLogEntryGlobal | undefined = $state();

	onMount(async () => {
		for (const l of git_manager.logs.values()) {
			onLogUpdateServerStatus(l, server_status, clone_urls, log_subs);
			const status = onLogUpdateGitStatus(l, [tip_id]);
			if (status) git_status = status;
		}
		git_manager.addEventListener('log', (e: Event) => {
			const customEvent = e as CustomEvent<GitManagerLogEntry>;
			onLogUpdateServerStatus(customEvent.detail, server_status, clone_urls, log_subs);
			const status = onLogUpdateGitStatus(customEvent.detail, [tip_id]);
			if (status) git_status = status;
		});
	});
	let identical_tip = $derived(
		new_commits && commits_on_branch && new_commits.length === 0 && commits_on_branch.length > 0
	);
</script>

{#if identical_tip}
	<EventWrapperLite {event} name_first>
		<span class="text-sm"> push PR update with an identical tip </span>
	</EventWrapperLite>
{:else}
	<EventWrapper {event}>
		{#if waited && !with_permission}
			<div class="bg-base-200/70 my-2 flex items-center gap-2 rounded p-2">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="h-4 w-4 flex-none">
					<title>Proposed</title>
					<path
						fill="currentColor"
						d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm1 11.5a.75.75 0 1 1-1.5 0v-4a.75.75 0 1 1 1.5 0v4zm0-6a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z"
					/>
				</svg>

				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<div class="flex-grow truncate font-medium">Proposed changes</div>
						<div class="text-base-content/50 shrink-0 text-xs"></div>
					</div>
					<div class="text-base-content/50 text-xs">User has no write permission</div>
				</div>
			</div>
		{/if}
		<CommitsDetails infos={new_commits} {loading} {server_status} {git_status} />
	</EventWrapper>
{/if}
