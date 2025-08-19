<script lang="ts">
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';
	import { getRepoShortDescription, getRepoShortName } from '$lib/type-helpers/repo';
	import { type PubKeyString, type RepoRouteString, type RepoTableItem } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';

	let {
		repo_item = undefined,
		lite = false,
		on_go = () => {}
	}: { repo_item: RepoTableItem | undefined; lite?: boolean; on_go?: () => void } = $props();

	let short_name = $derived(repo_item ? getRepoShortName(repo_item) : '');
	let short_description = $derived(getRepoShortDescription(repo_item));

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

{#if lite}
	<a
		class="btn btn-soft btn-sm btn-primary m-1"
		class:skeleton={!repo_item}
		class:btn-disabled={!repo_item}
		class:w-20={!repo_item}
		class:rounded-lg={!repo_item}
		href="/{repo_link}"
		onclick={(event) => {
			if (!repo_link) {
				event.preventDefault();
			} else {
				on_go();
			}
		}}
	>
		{short_name}
		{#if !repo_item}<div class="skeleton h-5 w-40"></div>{/if}</a
	>
{:else}
	<div
		class="bg-base-200 rounded-lg p-4"
		style={`min-height: ${maintainers.length * 1.325 + 2}rem;`}
	>
		{#if !repo_item}
			<div class="skeleton mb-2 h-5 w-40"></div>
			<div class="skeleton h-4 w-100"></div>
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
				<p class="text-muted pb-1 text-sm break-words">
					{short_description}
				</p>
			{/if}

			<div class="text-right text-xs break-words text-slate-400">
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
							{#each additional_maintainers as user (user)}
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
{/if}
