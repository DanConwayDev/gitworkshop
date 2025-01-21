<script lang="ts">
	import { icons_misc } from '$lib/icons';
	import InstallNgit from '$lib/components//InstallNgit.svelte';
	import {
		repoTableItemDefaults,
		type RepoRef,
		type RepoRoute,
		type RepoTableItem
	} from '$lib/types';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { WithLoading } from '$lib/types/ui';
	import { repoRouteToNostrUrl } from '$lib/git-utils';
	import UserHeader from '$lib/components/user/UserHeader.svelte';
	import AlertWarning from '$lib/components/AlertWarning.svelte';

	let {
		repo,
		repo_route,
		a_ref
	}: {
		repo?: RepoTableItem & Partial<WithLoading>;
		a_ref?: RepoRef;
		repo_route: RepoRoute;
	} = $props();

	let record_query = $derived(a_ref ? query_centre.fetchRepo(a_ref) : undefined);
	let item = $derived(
		repo ?? record_query?.current ?? (a_ref ? repoTableItemDefaults(a_ref) : undefined)
	);

	let nostr_url = $derived(repoRouteToNostrUrl(repo_route));
	let nostr_url_copied = $state(false);
	let git_url_copied: string | false = $state(false);
	let maintainer_copied = $state(false);
	let short_descrption = $derived.by(() => {
		const n = item?.description ?? '';
		return n.length > 500 ? `${n.slice(0, 450)}...` : n;
	});

	let loading = $derived(!item || (!item.created_at && item?.loading));
	let repo_not_found = $derived(!loading && item && !item.created_at);
</script>

<div class="prose w-full max-w-md">
	{#if !item || loading || repo_not_found}
		<h4 class="mt-0 pt-1">identifier</h4>
		<p class="my-2 break-words text-sm">{repo_route.identifier}</p>
	{:else if item.name == item.identifier}
		<h4 class="mt-0 pt-1">name / identifier</h4>
		<p class="my-2 break-words text-sm">{item.name}</p>
	{:else}
		<h4>name</h4>
		{#if !item.name || item.name.length == 0}
			<div>none</div>
		{:else}
			<p class="my-2 break-words text-sm">{item.name}</p>
		{/if}
		<h4>identifier</h4>
		{#if !item.identifier || item.identifier.length == 0}
			<div>none</div>
		{:else}
			<p class="my-2 break-words text-sm">{item.identifier}</p>
		{/if}
	{/if}
	<div class="dropdown dropdown-end mt-3">
		<div tabIndex={0} class="btn btn-success btn-sm text-base-400">
			clone
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				class="h-5 w-5 flex-none fill-success-content"
				><path
					fill="currentColor"
					d="M11.646 15.146L5.854 9.354a.5.5 0 0 1 .353-.854h11.586a.5.5 0 0 1 .353.854l-5.793 5.792a.5.5 0 0 1-.707 0"
				/></svg
			>
		</div>
		<ul
			tabIndex={0}
			class="w-md menu dropdown-content z-[1] ml-0 rounded-box bg-base-300 p-2 shadow"
		>
			<li class="prose">
				<div>
					<div>
						<h4 class="mt-0">1. install ngit and git-remote-nostr</h4>
						<InstallNgit size="sm" />
					</div>
				</div>
			</li>
			<li class="m-0 p-0">
				<!-- eslint-disable-next-line svelte/valid-compile -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					onclick={async () => {
						try {
							await navigator.clipboard.writeText(nostr_url);
							nostr_url_copied = true;
							setTimeout(() => {
								nostr_url_copied = false;
							}, 2000);
						} catch {
							/* empty */
						}
					}}
					class="group cursor-pointer rounded-md"
				>
					<div>
						<h4 class="mt-0 pt-0">
							2. copy git clone url
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								class="ml-1 inline h-4 w-4 flex-none fill-base-content opacity-50 group-hover:opacity-100"
								class:fill-base-content={!nostr_url_copied}
								class:fill-success={nostr_url_copied}
							>
								{#each icons_misc.copy as d}
									<path {d} />
								{/each}
							</svg>

							{#if nostr_url_copied}<span class="text-sm text-success opacity-50">
									(copied to clipboard)</span
								>{/if}
						</h4>
						<p class="my-2 break-words border p-2 text-xs">{nostr_url}</p>
					</div>
				</div>
			</li>
		</ul>
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		{:else if !short_descrption || short_descrption.length == 0}
			<h4>description</h4>
			<div>none</div>
		{:else}
			<h4>description</h4>
			<p class="my-2 break-words text-sm">{short_descrption}</p>
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="badge skeleton w-20"></div>
			<div class="badge skeleton w-20"></div>
		{:else if item.tags}
			{#each item.tags as tag}
				<div class="badge badge-secondary mr-2">{tag}</div>
			{/each}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
		{:else}
			<h4>
				git servers {#if git_url_copied}<span class="text-sm text-success opacity-50">
						(copied to clipboard)</span
					>{/if}
			</h4>
			{#if !item.clone || item.clone.length == 0}
				<div>none</div>
			{:else}
				{#each item.clone as git_url}
					<!-- eslint-disable-next-line svelte/valid-compile -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						onclick={async () => {
							try {
								await navigator.clipboard.writeText(git_url);
								git_url_copied = git_url;
								setTimeout(() => {
									git_url_copied = false;
								}, 2000);
							} catch {
								/* empty */
							}
						}}
						class="group my-2 mt-3 cursor-pointer break-words text-xs"
						class:text-success={git_url_copied === git_url}
						class:opacity-50={git_url_copied === git_url}
					>
						{git_url}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="ml-1 inline h-4 w-4 flex-none fill-base-content opacity-50"
							class:group-hover:opacity-100={git_url_copied !== git_url}
							class:fill-base-content={git_url_copied !== git_url}
							class:fill-success={git_url_copied === git_url}
							class:opacity-100={git_url_copied === git_url}
						>
							{#each icons_misc.copy as d}
								<path {d} />
							{/each}
						</svg>
					</div>
				{/each}
			{/if}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else if !item.web || item.web.length == 0}
			<h4>websites</h4>
			<div>none</div>
		{:else}
			<h4>websites</h4>
			{#each item.web as site}
				<a href={site} target="_blank" class="link link-primary my-2 break-words text-sm">
					{site}
				</a>
			{/each}
		{/if}
	</div>

	<div>
		{#if !item || loading || !item.author}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else}
			<h4>
				{#if repo_not_found}author{:else}maintainers{/if}
				{#if maintainer_copied}<span class="text-sm text-success opacity-50">
						(copied to clipboard)</span
					>{/if}
			</h4>
			{#if !item.maintainers || item.maintainers.length == 0}
				<div class="my-2 mt-3 break-words text-xs">
					<UserHeader user={item.author} />
				</div>
			{:else}
				{#each item.maintainers as maintainer}
					<div class="my-2 mt-3 break-words text-xs">
						<UserHeader user={maintainer} />
					</div>
				{/each}
			{/if}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else if !item.relays || item.relays.length == 0}
			<h4>relays</h4>
			<div>none</div>
		{:else}
			<h4>relays</h4>
			{#each item.relays as relay}
				<div class="badge badge-secondary badge-sm my-2 block">{relay}</div>
			{/each}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		{:else if !item.unique_commit || item.unique_commit.length == 0}
			<h4>earliest unique commit</h4>
			<p class="my-2 break-words text-xs">not specified</p>
		{:else}
			<h4>earliest unique commit</h4>
			<p class="my-2 break-words text-xs">{item.unique_commit}</p>
		{/if}
	</div>

	{#if repo_not_found}
		<div class="text-xs">
			<AlertWarning>
				<div class="pb-1 font-semibold">missing repository details</div>
				<div>cannot find referenced repository event</div>
			</AlertWarning>
		</div>
	{/if}
</div>
