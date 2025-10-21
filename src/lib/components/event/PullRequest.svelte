<script lang="ts">
	import 'highlight.js/styles/agate.min.css';
	import { type NostrEvent } from 'nostr-tools';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import { getTagMultiValue, getTagValue } from '$lib/utils';
	import git_manager from '$lib/git-manager';
	import {
		type CommitInfo,
		type GitManagerLogEntry,
		type GitManagerLogEntryGlobal,
		type GitServerStatus
	} from '$lib/types/git-manager';
	import { onMount } from 'svelte';
	import CommitsDetails from '../prs/CommitsDetails.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { onLogUpdateGitStatus, onLogUpdateServerStatus } from '$lib/git-utils';

	let { event }: { event: NostrEvent } = $props();

	let content = $derived(nostrEventToDocTree(event, true));

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
</script>

<div class="">
	<ContentTree node={content} />
	<CommitsDetails infos={commits} {loading} {server_status} {git_status} />
</div>
