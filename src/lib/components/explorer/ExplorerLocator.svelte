<script lang="ts">
	import { slide } from 'svelte/transition';
	import type { GitServerState, GitServerStatus, SelectedRefInfo } from '$lib/types/git-manager';
	import type { SvelteMap } from 'svelte/reactivity';
	import FromNow from '../FromNow.svelte';
	import { pr_icon_path } from '../prs/icons';
	import AlertWarning from '../AlertWarning.svelte';
	import ExplorerServerStatusIcon from './ExplorerServerStatusIcon.svelte';

	let {
		base_url,
		identifier,
		path,
		selected_ref_info,
		default_branch,
		branches = [],
		tags = [],
		server_status,
		git_warning
	}: {
		base_url: string;
		identifier: string;
		path: string;
		selected_ref_info: SelectedRefInfo | undefined;
		default_branch?: string | undefined;
		branches: string[];
		tags: string[];
		server_status: SvelteMap<string, GitServerStatus>;
		git_warning?: string;
	} = $props();

	let selected_ref = $derived(selected_ref_info?.ref ?? '');
	let path_structure = $derived(path.split('/'));
	let is_branch = $derived(selected_ref.startsWith('refs/heads/'));
	let selected_ref_short = $derived(
		is_branch ? selected_ref.replace('refs/heads/', '') : selected_ref.replace('refs/tags/', '')
	);
	let base_url_without_tree = $derived(base_url.split('/tree/')[0]);
	let show_branch_selector = $derived(branches.length > 0 && selected_ref);

	let overal_server_status: GitServerState | undefined = $derived.by(() => {
		if (server_status.entries().some((e) => e[1].state === 'connecting')) return 'connecting';
		if (server_status.entries().some((e) => e[1].state === 'connected')) return 'connected';
		if (server_status.entries().some((e) => e[1].state === 'fetching')) return 'fetching';
		if (server_status.entries().some((e) => e[1].state === 'fetched')) return 'fetched';
		if (server_status.entries().some((e) => e[1].state === 'failed')) return 'failed';
	});

	let force_show_bottom = $state(false);
	let force_hide_bottom = $state(false);
	let show_bottom = $derived.by(() => {
		if (force_show_bottom) return true;
		if (force_hide_bottom) return false;
		return overal_server_status === 'fetched';
	});
</script>

{#snippet showStatusIndicatorStatus(state: GitServerState | undefined, classes: string = '')}
	{#if state}
		<span
			class="indicator-item status {classes}"
			class:status-success={['connected', 'fetched'].includes(state)}
			class:status-warning={state === 'connecting' || state === 'fetching'}
			class:status-error={state === 'failed'}
		></span>
	{/if}
{/snippet}

<div
	class="border-base-400 bg-base-200 my-2 flex items-center rounded-t-lg border-x border-t"
	class:mb-0={show_bottom || !!git_warning}
	class:rounded-lg={!show_bottom}
	class:border={!show_bottom}
>
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
						aria-label="Branches ({branches.length})"
						checked={is_branch}
					/>
					<ul class="tab-content menu">
						{#if branches.length == 0}
							<li class="menu-disabled mx-10"><div class="m-auto my-6">none</div></li>
						{/if}
						{#each branches as branch (branch)}
							<li>
								<a
									class:menu-active={is_branch && branch === selected_ref_short}
									href="{base_url_without_tree}/tree/{branch}/{path}"
									>{branch}
									{#if branch === default_branch?.replace('refs/heads/', '')}<span
											class="badge badge-sm">default</span
										>{/if}
								</a>
							</li>
						{/each}
					</ul>
					<input
						type="radio"
						name="my_tabs_3"
						class="tab"
						aria-label="Tags ({tags.length})"
						checked={!is_branch}
					/>
					<ul class="tab-content menu max-h-98 overflow-y-auto">
						{#if tags.length == 0}
							<li class="menu-disabled mx-10"><div class="m-auto my-6">none</div></li>
						{/if}
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
	{#if selected_ref_info}
		<div class="text-base-content/50 text-xs">
			<FromNow unix_seconds={selected_ref_info.commit.committer.timestamp} />
		</div>
		<div class="text-base-content/50 mx-2 text-xs">{selected_ref_info.commit.author.name}</div>
		<div class="badge badge-sm mr-2">{selected_ref_info.commit_id.substring(0, 8)}</div>
	{/if}
	<button
		class="btn btn-sm btn-neutral mr-2"
		onclick={() => {
			if (show_bottom) {
				force_hide_bottom = false;
				force_show_bottom = false;
				// force show only if required
				if (show_bottom) {
					force_hide_bottom = true;
				}
			} else {
				force_hide_bottom = false;
				force_show_bottom = false;
				// force hide only if required
				if (!show_bottom) {
					force_show_bottom = true;
				}
			}
		}}
	>
		<div class="indicator">
			{@render showStatusIndicatorStatus(overal_server_status, 'indicator-bottom indicator-right')}
			<ExplorerServerStatusIcon {server_status} />
		</div>
	</button>
</div>
{#if show_bottom}
	<div
		in:slide={{ duration: 100 }}
		out:slide={{ duration: 100 }}
		class="border-base-400 bg-base-100 flex items-center rounded-b-lg border-x border-b"
		class:mb-0={!!git_warning}
		class:mb-2={!git_warning}
	>
		<div class="mx-5 my-5">
			{#each server_status.entries() as [remote, status] (remote)}
				<div>
					{@render showStatusIndicatorStatus(status.state)}
					{status.short_name}
					{#if status.with_proxy}
						<span class="text-base-content/50 text-xs">(via proxy)</span>
					{/if}
					<span class="text-base-content/50 text-xs">{status.state}</span>
					<span class="text-base-content/50 text-xs">{status.msg}</span>
				</div>
			{/each}
		</div>
	</div>
{/if}
{#if git_warning}
	<div class="mb-4">
		<AlertWarning mt={4}>
			<div>{git_warning}</div>
		</AlertWarning>
	</div>
{/if}
