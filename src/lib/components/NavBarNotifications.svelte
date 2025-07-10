<script>
	import { goto } from '$app/navigation';
</script>

<div class="relative">
	<div class="indicator">
		<span class="indicator-item"></span>
		<button
			class="btn btn-ghost btn-sm mt-1 h-6 px-2 pb-1 pt-1"
			onclick={() => {
				goto('/notifications');
			}}
		>
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<title>notifications</title>
				<path
					d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9zm-4.22 12a1.999 1.999 0 0 1-3.56 0"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>
</div>
