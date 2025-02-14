<script lang="ts">
	import { type PubKeyString } from '$lib/types';
	import UserHeader from './UserHeader.svelte';

	let {
		users = []
	}: {
		users?: PubKeyString[];
	} = $props();

	let max_show = 4;
</script>

<div class="avatar-group -space-x-2 rtl:space-x-reverse">
	{#each users.slice(0, max_show) as user}
		<div class="avatar border-none">
			<div class="">
				<UserHeader {user} avatar_only inline size="md" link_to_profile={false} in_group />
			</div>
		</div>
	{/each}
	{#if users.length > max_show}
		<div class="avatar placeholder h-5 border-none">
			<div class="bg-neutral text-neutral-content">
				<span class="text-xs opacity-50">+{users.length - max_show}</span>
			</div>
		</div>
	{/if}
</div>
