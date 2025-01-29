<script lang="ts">
	import { isRepoTableItem, type RepoRoute, type RepoTableItem } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';
	import Container from '../Container.svelte';
	import { getRepoShortName } from '$lib/type-helpers/repo';
	import { isStrugglingToFindItem } from '$lib/type-helpers/general';
	import RepoMenu from './RepoMenu.svelte';
	import type { WithLoading } from '$lib/types/ui';
	import store, { network_status } from '$lib/store.svelte';

	let { repo, url }: { repo?: RepoTableItem & WithLoading; url: string } = $props();

	let repo_route = $derived(store.route as RepoRoute);
	let short_name = $derived(!repo ? repo_route.identifier : getRepoShortName(repo));
	let struggling = $derived(
		repo && isRepoTableItem(repo) ? !network_status.offline && isStrugglingToFindItem(repo) : false
	);
</script>

<div class="border-b border-accent-content bg-base-300">
	<Container no_wrap={true}>
		<a href={`/${repo_route.s}`} class="strong btn btn-ghost mb-0 mt-0 break-words px-3 text-sm"
			>{short_name}</a
		>
		{#if repo && !repo.created_at && struggling}
			<span class="text-xs text-warning">
				struggling to find referenced repository event by <div
					class="badge bg-base-400 text-warning"
				>
					<UserHeader user={repo.author} inline size="xs" />
				</div>
			</span>
		{/if}
		<RepoMenu {repo} {url} />
	</Container>
</div>
