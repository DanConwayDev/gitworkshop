<script lang="ts">
	import { type RepoTableItem } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';
	import Container from '../Container.svelte';
	import { getRepoShortName } from '$lib/type-helpers/repo';
	import { isStrugglingToFindItem } from '$lib/type-helpers/general';
	import RepoMenu from './RepoMenu.svelte';
	import type { RepoPage } from '$lib/types/ui';
	import { network_status } from '$lib/internal_states.svelte';

	let { repo }: { repo?: RepoTableItem } = $props();

	let selected_tab: RepoPage = 'about';
	let short_name = $derived(getRepoShortName(repo));
	let repo_link = '/naddr';
	let struggling = $derived(repo ? !network_status.offline && isStrugglingToFindItem(repo) : false);
</script>

<div class="border-b border-accent-content bg-base-300">
	<Container no_wrap={true}>
		{#if !repo}
			<div class="p-3">
				<div class="skeleton h-6 w-28 bg-base-200"></div>
			</div>
		{:else}
			<a href={repo_link} class="strong btn btn-ghost mb-0 mt-0 break-words px-3 text-sm"
				>{short_name}</a
			>
			{#if !repo.created_at && struggling}
				<span class="text-xs text-warning">
					struggling to find referenced repository event by <div
						class="badge bg-base-400 text-warning"
					>
						<UserHeader user={repo.author} inline size="xs" />
					</div>
				</span>
			{/if}
		{/if}
		<RepoMenu {selected_tab} {repo} />
	</Container>
</div>
