<script lang="ts">
	import dayjs from 'dayjs';
	import relativeTime from 'dayjs/plugin/relativeTime';
	import { onMount } from 'svelte';

	let { unix_seconds }: { unix_seconds: number } = $props();
	dayjs.extend(relativeTime);

	let s = $state(dayjs(unix_seconds * 1000).fromNow());

	onMount(() => {
		const interval = setInterval(() => {
			dayjs(unix_seconds * 1000).fromNow();
		}, 1000);
		return () => {
			clearInterval(interval);
		};
	});
</script>

<span>{s}</span>
