<script lang="ts">
	import type { RepoRef } from '$lib/types';

	let { data }: { data: { a_ref: RepoRef } } = $props();

	let { a_ref } = data;
</script>

<div>REPO HOMPAGE PLACHOLDER {a_ref}</div>
