<script lang="ts">
	import { unixNow } from 'applesauce-core/helpers';
	import dayjs from 'dayjs';
	import duration from 'dayjs/plugin/duration';
	import { onMount } from 'svelte';

	let { from_s, to_s }: { from_s: number; to_s?: number | undefined } = $props();
	dayjs.extend(duration);

	let now = $state(unixNow());

	onMount(() => {
		let interval = setInterval(() => {
			now = unixNow();
		}, 1000);
		return () => {
			clearInterval(interval);
		};
	});

	let to = $derived(to_s ?? now);
	const duration_string = $derived.by(() => {
		const durationInSeconds = to - from_s;
		const durationObj = dayjs.duration(durationInSeconds, 'seconds');

		const hours = Math.floor(durationObj.asHours());
		const minutes = durationObj.minutes();
		const seconds = durationObj.seconds();

		// Construct the duration string in short format
		const parts = [];
		if (hours > 0) {
			parts.push(`${hours}h`);
		}
		if (minutes > 0) {
			parts.push(`${minutes}m`);
		}
		// Always show seconds, even if 0, to maintain the format
		parts.push(`${seconds.toString().padStart(2, '0')}s`);

		return parts.join(' ');
	});
</script>

<span>{duration_string}</span>
