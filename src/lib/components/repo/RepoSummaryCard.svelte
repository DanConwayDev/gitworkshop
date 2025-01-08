<script lang="ts">
	import { repoToNaddr } from '$lib/repos';
	import type { Naddr, PubKeyString, RepoTableItem } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';

	export let repo_item: RepoTableItem | undefined = undefined;

	let short_name: string = 'Untitled';
	$: {
		if (repo_item) {
			const value = repo_item.name ?? repo_item.identifier;
			if (value) {
				short_name = value.length > 45 ? value.slice(0, 45) + '...' : value;
			}
		}
	}

	let short_description: string = '';
	$: {
		if (repo_item?.description) {
			short_description =
				repo_item.description.length > 50
					? repo_item.description.slice(0, 45) + '...'
					: repo_item.description;
		}
	}

	let author: PubKeyString | undefined = undefined;
	$: {
		if (repo_item) {
			// if ('trusted_maintainer' in repo_item) author = repo_item.trusted_maintainer;
			// else if ('pubkey' in repo_item) author = repo_item.pubkey;
			// else if ('author' in repo_item) author = repo_item.author;
			author = repo_item.author;
		}
	}

	let maintainers: PubKeyString[] = [];
	let additional_maintainers: PubKeyString[] = [];
	$: {
		if (repo_item && 'maintainers' in repo_item)
			additional_maintainers = (repo_item.maintainers || []).filter((pubkey) => pubkey !== author);
		maintainers = author ? [author, ...additional_maintainers] : additional_maintainers;
	}

	let naddr: Naddr | undefined = undefined;
	$: {
		if (repo_item) {
			naddr = repoToNaddr(repo_item);
		}
	}
</script>

<div class="rounded-lg bg-base-200 p-4" style={`min-height: ${maintainers.length * 1.325 + 2}rem;`}>
	{#if !repo_item}
		<div class="skeleton mb-2 h-5 w-40"></div>
		<div class="w-100 skeleton h-4"></div>
	{:else}
		<a
			class="link-primary break-words"
			href="/r/{naddr}"
			on:click={(event) => {
				if (!naddr) {
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
