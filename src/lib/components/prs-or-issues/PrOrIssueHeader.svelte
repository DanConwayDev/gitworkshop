<script lang="ts">
	import type { IssueOrPRTableItem } from '$lib/types';
	import Container from '../Container.svelte';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import Status from './Status.svelte';

	let { table_item, type }: { table_item?: IssueOrPRTableItem; type: 'pr' | 'issue' } = $props();

	let short_title = $derived.by(() => {
		const n = table_item ? table_item.title : 'Untitled';
		return n.length > 70 ? `${n.slice(0, 65)}...` : n;
	});
	let logged_in_user = false;
</script>

<div class="grow border-b border-accent-content bg-base-200 pb-4 pt-2 text-xs text-neutral-content">
	<Container>
		{#if !table_item}
			<div>
				<div class="skeleton h-7 w-60 pt-1"></div>
				<div class="">
					<div class="skeleton mt-3 inline-block h-8 w-20 align-middle"></div>
					<div class="skeleton ml-3 mt-5 inline-block h-3 w-28 align-middle"></div>
					<div class="skeleton ml-3 mt-5 inline-block h-3 w-28 align-middle"></div>
				</div>
			</div>
		{:else}
			<div class="mb-2 text-lg text-base-content">
				{short_title}
			</div>
			<div class="pt-1">
				<div class="mr-3 inline align-middle">
					{#if !logged_in_user}
						<Status {type} status={table_item.status} edit_mode={false} />
						<!-- {:else}
						<StatusSelector {type} {status} pr_or_issue_id={id} /> -->
					{/if}
				</div>
				<div class="mr-3 inline align-middle">
					opened <FromNow unix_seconds={table_item.created_at} />
				</div>
				<div class="inline align-middle">
					<UserHeader user={table_item.author} inline={true} no_avatar={true} size="xs" />
				</div>
			</div>
		{/if}
	</Container>
</div>
