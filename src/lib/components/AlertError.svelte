<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children, mt = 6 }: { children: Snippet; mt?: number } = $props();
</script>

<div role="alert" class="m-auto max-w-xl">
	<div role="alert" class="alert alert-error mt-{mt} m-auto bg-error">
		<!-- https://icon-sets.iconify.design/ph/warning-fill/ -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-6 w-6 shrink-0 stroke-current"
			viewBox="0 0 256 256"
		>
			<path
				fill="currentColor"
				d="M236.8 188.09L149.35 36.22a24.76 24.76 0 0 0-42.7 0L19.2 188.09a23.51 23.51 0 0 0 0 23.72A24.35 24.35 0 0 0 40.55 224h174.9a24.35 24.35 0 0 0 21.33-12.19a23.51 23.51 0 0 0 .02-23.72M120 104a8 8 0 0 1 16 0v40a8 8 0 0 1-16 0Zm8 88a12 12 0 1 1 12-12a12 12 0 0 1-12 12"
			/></svg
		>
		<div>
			{@render children?.()}
		</div>
	</div>
</div>
