<script lang="ts">
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';
	import { getRepoShortDescription, getRepoShortName } from '$lib/type-helpers/repo';
	import { type PubKeyString, type RepoRouteString, type RepoTableItem } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';

	let { repo_item = undefined }: { repo_item: RepoTableItem | undefined } = $props();

	let short_name = $derived.by(() => getRepoShortName(repo_item));
	let short_description = $derived.by(() => getRepoShortDescription(repo_item));

	let author: PubKeyString | undefined = $derived(repo_item?.author);

	// TODO repo_item.maintainers is an array so new items or item updatew wont be reactive
	let additional_maintainers: PubKeyString[] = $derived(
		repo_item?.maintainers?.filter((pubkey) => pubkey !== author) || []
	);

	let maintainers: PubKeyString[] = $derived([
		...(author ? [author] : []),
		...(additional_maintainers || [])
	]);

	let link_creator = $derived(repo_item ? new RepoRouteStringCreator(repo_item) : undefined);
	let repo_link: RepoRouteString | undefined = $derived(link_creator ? link_creator.s : undefined);
</script>

<div class="rounded-lg bg-base-200 p-4" style={`min-height: ${maintainers.length * 1.325 + 2}rem;`}>
	{#if !repo_item}
		<div class="skeleton mb-2 h-5 w-40"></div>
		<div class="w-100 skeleton h-4"></div>
	{:else}
		<a
			class="link-primary break-words"
			href="/{repo_link}"
			onclick={(event) => {
				if (!repo_link) {
					event.preventDefault();
				}
			}}>{short_name}</a
		>
		{#if short_description.length > 0}
			<p class="text-muted break-words pb-1 text-sm">
				{short_description}
			</p>
		{/if}

		<div class="break-words text-right text-xs text-slate-400">
			{#if author}
				<div
					class="inline"
					class:p-1={additional_maintainers.length > 0}
					class:rounded-md={additional_maintainers.length > 0}
					class:bg-base-400={additional_maintainers.length > 0}
					class:text-white={additional_maintainers.length > 0}
				>
					<UserHeader user={author} inline={true} size="xs" />
				</div>
				{#if additional_maintainers.length > 0}
					<span>with</span>

					<ul class="reposummarycard inline">
						{#each additional_maintainers as user}
							<li class="inline">
								<UserHeader {user} inline={true} size="xs" />
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>
	{/if}
</div>
