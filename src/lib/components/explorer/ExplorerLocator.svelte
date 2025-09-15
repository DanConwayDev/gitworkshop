<script lang="ts">
	import { pr_icon_path } from '../prs/icons';

	let {
		base_url,
		identifier,
		path,
		selected_ref,
		branches = [],
		tags = []
	}: {
		base_url: string;
		identifier: string;
		path: string;
		selected_ref: string;
		branches: string[];
		tags: string[];
	} = $props();

	let path_structure = $derived(path.split('/'));
	let is_branch = $derived(selected_ref.startsWith('refs/heads/'));
	let selected_ref_short = $derived(
		is_branch ? selected_ref.replace('refs/heads/', '') : selected_ref.replace('refs/tags/', '')
	);
	let base_url_without_tree = $derived(base_url.split('/tree/')[0]);
	let show_branch_selector = $derived(branches.length > 0 && selected_ref);
</script>

<div class="border-base-400 bg-base-200 my-2 flex items-center rounded rounded-lg border">
	{#if show_branch_selector}
		<div class="dropdown">
			<div tabindex="0" role="button" class="btn btn-sm btn-neutral m-2 pr-2">
				{#if !selected_ref}
					<div class="skeleton h-4 w-4 opacity-25"></div>
					<div class="skeleton h-4 w-12 opacity-25"></div>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="h-4 w-4 flex-none">
						{#if is_branch}
							<title>Branch</title>
							<path fill="currentColor" d={pr_icon_path.branch} />
						{:else}
							<title>Branch</title>
							<path fill="currentColor" d={pr_icon_path.tag} />
						{/if}
					</svg>
					{selected_ref_short}
				{/if}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 flex-none"
					><path
						fill="currentColor"
						d="M11.646 15.146L5.854 9.354a.5.5 0 0 1 .353-.854h11.586a.5.5 0 0 1 .353.854l-5.793 5.792a.5.5 0 0 1-.707 0"
					/></svg
				>
			</div>
			<div
				class="dropdown-content bg-base-100 border-base-400 bg-base-200 z-1 w-sm rounded border p-2 shadow-sm"
			>
				<div class="tabs tabs-border">
					<input
						type="radio"
						name="my_tabs_3"
						class="tab"
						aria-label="Branches"
						checked={is_branch}
					/>
					<ul class="tab-content menu">
						{#each branches as branch (branch)}
							<li>
								<a
									class:menu-active={is_branch && branch === selected_ref_short}
									href="{base_url_without_tree}/tree/{branch}/{path}"
									>{branch}
								</a>
							</li>
						{/each}
					</ul>
					<input type="radio" name="my_tabs_3" class="tab" aria-label="Tags" checked={!is_branch} />
					<ul class="tab-content menu max-h-98 overflow-y-auto">
						{#each tags as tag (tag)}
							<li>
								<a
									class:menu-active={!is_branch && tag === selected_ref_short}
									href="{base_url_without_tree}/tree/{encodeURIComponent(
										`refs/tags/${tag}`
									)}/{path}">{tag}</a
								>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>
	{/if}
	<div class:mx-4={!show_branch_selector} class="m-2 mx-2 flex-grow py-1">
		<a class="link-hover link link-secondary" href={base_url}>{identifier}</a>
		{#if path !== ''}
			{#each path_structure as dir, i (i)}
				<span class="px-1">
					<span class="opacity-25">/</span>
					{#if i === path_structure.length - 1}
						<span>{dir}</span>
					{:else}
						<a
							class="link-hover link link-secondary"
							href={`${base_url}/${path
								.split('/')
								.slice(0, i + 1)
								.join('/')}`}>{dir}</a
						>
					{/if}
				</span>
			{/each}
		{/if}
	</div>
</div>
