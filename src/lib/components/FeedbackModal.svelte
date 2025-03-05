<script lang="ts">
	import { onMount } from 'svelte';
	import ComposeFeedback from './compose/ComposeFeedback.svelte';
	let { done }: { done: () => void } = $props();

	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') done();
		});
		window.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains('modal-open') && !target.classList.contains('modal-box'))
				done();
		});
	});
</script>

<dialog class="modal modal-open">
	<div class="modal-box max-w-lg overflow-hidden text-wrap">
		<div class="prose mb-5"><h3>Feedback</h3></div>

		<ComposeFeedback {done} />

		<div class="modal-action">
			<button class="btn btn-sm" onclick={done}>Close</button>
		</div>
	</div>
</dialog>
