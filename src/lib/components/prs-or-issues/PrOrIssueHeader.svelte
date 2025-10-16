<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { PrKind } from '$lib/kinds';
	import type { IssueOrPRTableItem } from '$lib/types';
	import Container from '../Container.svelte';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import StatusSelector from './StatusSelector.svelte';

	let {
		table_item,
		active_tab = 'conversation'
	}: { table_item?: IssueOrPRTableItem; active_tab: 'conversation' | 'commits' | 'files' } =
		$props();

	let short_title = $derived.by(() => {
		const n = table_item ? table_item.title : 'Untitled';
		return n.length > 70 ? `${n.slice(0, 65)}...` : n;
	});
	let pr_base_url = $derived(active_tab == 'conversation' ? page.url.href.replace(/\/$/, '') : '.');
</script>

<div class="border-accent-content bg-base-200 text-neutral-content grow border-b text-xs">
	<Container>
		<div class="flex flex-wrap items-end">
			<div class="pt-2 pb-4">
				{#if !table_item}
					<div>
						<div class="skeleton h-7 w-60 pt-1"></div>
						<div class="">
							<div class="skeleton mt-3 inline-block h-8 w-20 align-middle"></div>
							<div class="skeleton mt-5 ml-3 inline-block h-3 w-28 align-middle"></div>
							<div class="skeleton mt-5 ml-3 inline-block h-3 w-28 align-middle"></div>
						</div>
					</div>
				{:else}
					<div class="text-base-content mb-2 text-lg">
						{short_title}
					</div>
					<div class="pt-1">
						<div class="mr-3 inline align-middle">
							<StatusSelector item={table_item} />
						</div>
						<div class="mr-3 inline align-middle">
							opened <FromNow unix_seconds={table_item.created_at} />
						</div>
						<div class="inline align-middle">
							<UserHeader user={table_item.author} inline={true} no_avatar={true} size="xs" />
						</div>
					</div>
				{/if}
			</div>
			<div class="flex-grow"></div>
			<div class="flex items-end">
				{#if table_item?.event.kind === PrKind}
					<div class="tabs tabs-lift -mb-[1px]">
						<a
							class="tab [--tab-border-color:black]"
							class:tab-active={active_tab === 'conversation'}
							class:border-none={active_tab !== 'conversation'}
							href={resolve(
								(active_tab === 'conversation' ? page.url.href : pr_base_url) as `/${string}`
							)}
							onclick={(e) => {
								if (active_tab === 'conversation') e.preventDefault();
							}}
						>
							Conversation
						</a>
						<a
							class="tab [--tab-border-color:black]"
							class:tab-active={active_tab === 'commits'}
							class:border-none={active_tab !== 'commits'}
							href={resolve(
								(active_tab === 'commits'
									? page.url.href
									: `${pr_base_url}/commits`) as `/${string}`
							)}
							onclick={(e) => {
								if (active_tab === 'commits') e.preventDefault();
							}}
						>
							Commits
						</a>
						<a
							class="tab [--tab-border-color:black]"
							class:tab-active={active_tab === 'files'}
							class:border-none={active_tab !== 'files'}
							href={resolve(
								(active_tab === 'files' ? page.url.href : `${pr_base_url}/files`) as `/${string}`
							)}
							onclick={(e) => {
								if (active_tab === 'files') e.preventDefault();
							}}
						>
							Files Changed
						</a>
					</div>
				{/if}
			</div>
			<div></div>
		</div></Container
	>
</div>
