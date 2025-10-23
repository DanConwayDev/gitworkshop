<script lang="ts">
	import type { GitManagerLogEntry } from '$lib/types/git-manager';
	import GitServerStateIndicator from './GitServerStateIndicator.svelte';
	import BackgroundProgressWrapper from './BackgroundProgressWrapper.svelte';
	import {
		gitProgressToPc,
		remoteNameToShortName,
		serverStatustoMsg,
		getLatestLogFromEachServer,
		getFetchStatusMessage,
		gitProgressesBySub
	} from '$lib/git-utils';

	let {
		loading,
		waited,
		git_log,
		sub_filter,
		clone_urls,
		errorMessage,
		commits_or_diffs,
		use_progress_wrapper = false
	}: {
		loading: boolean;
		waited: boolean;
		git_log: GitManagerLogEntry[];
		sub_filter: string[];
		clone_urls: string[];
		errorMessage: string;
		commits_or_diffs?: unknown[];
		use_progress_wrapper?: boolean;
	} = $props();

	let server_latest_log = $derived(getLatestLogFromEachServer(git_log, sub_filter, clone_urls));
	let statusMessage = $derived(
		getFetchStatusMessage(git_log, sub_filter, clone_urls, commits_or_diffs)
	);
	let pcLoaded = $derived(gitProgressesBySub(git_log, sub_filter, clone_urls));
</script>

{#snippet showServerStatus()}
	{#if server_latest_log.length > 0}
		<div class="mx-5 my-5">
			{#each server_latest_log as status (status.remote)}
				{#if use_progress_wrapper}
					<BackgroundProgressWrapper
						complete_bg_color_class="bg-base-400"
						pc={status.progress ? gitProgressToPc(status.progress) : 0}
					>
						<GitServerStateIndicator state={status.state} />
						{remoteNameToShortName(status.remote, clone_urls)}
						{#if status.msg?.includes('proxy')}
							<span class="text-base-content/50 text-xs">(via proxy)</span>
						{/if}
						<span class="text-base-content/50 text-xs">{status.state}</span>
						<span class="text-base-content/50 text-xs">{serverStatustoMsg(status)}</span>
					</BackgroundProgressWrapper>
				{:else}
					<div>
						<GitServerStateIndicator state={status.state} />
						{remoteNameToShortName(status.remote, clone_urls)}
						{#if status.msg?.includes('proxy')}
							<span class="text-base-content/50 text-xs">(via proxy)</span>
						{/if}
						<span class="text-base-content/50 text-xs">{status.state}</span>
						<span class="text-base-content/50 text-xs">{status.msg}</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}

{#if loading || !waited}
	<div class="skeleton border-base-400 my-2 rounded border border-2 opacity-70">
		<BackgroundProgressWrapper complete_bg_color_class="bg-base-400" pc={pcLoaded}>
			<div class="p-2">
				<div
					class="text-center transition-opacity duration-2000"
					class:opacity-0={!waited && loading}
				>
					<span class="loading loading-spinner loading-sm opacity-60"></span>
					<span class=" text-muted ml-2 text-[0.85rem] font-medium">{statusMessage}</span>
				</div>
			</div>
		</BackgroundProgressWrapper>
		<div class="">
			<div class="min-h-16 transition-opacity duration-2000" class:opacity-0={!waited && loading}>
				{@render showServerStatus()}
			</div>
		</div>
	</div>
{:else}
	<div class="bg-base-200 border-error/90 my-2 rounded border border-2">
		<div class="bg-error text-error-content p-2 text-center">{errorMessage}</div>
		<div class="">
			<div class="min-h-16 transition-opacity duration-1500" class:opacity-0={!waited && loading}>
				{@render showServerStatus()}
			</div>
		</div>
	</div>
{/if}
