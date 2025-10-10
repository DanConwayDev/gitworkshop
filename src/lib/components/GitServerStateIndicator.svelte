<script lang="ts">
	import type { GitServerState } from '$lib/types/git-manager';

	let { state, classes = '' }: { state: GitServerState; classes?: string } = $props();
</script>

{#if state}
	<span
		class="indicator-item status {classes}"
		class:status-success={['connected', 'fetched'].includes(state)}
		class:status-warning={state === 'connecting' || state === 'fetching'}
		class:status-error={state === 'failed'}
	></span>
{/if}
