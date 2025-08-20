<script lang="ts">
	import type { FileEntry } from '$lib/types/git-manager';
	import { onMount } from 'svelte';

	let {
		loading_msg = undefined,
		path,
		selected_file,
		file_details,
		base_url,
		error
	}: {
		loading_msg?: string | undefined;
		path: string;
		selected_file?: string;
		file_details?: FileEntry[];
		error?: string;
		base_url: string;
	} = $props();

	const getParentDir = (path: string) => {
		// Split the path by '/' and remove the last segment
		const segments = path.split('/');
		segments.pop();
		return segments.join('/');
	};
	let path_structure = $derived(path.split('/'));
	let file_details_wrapper = $derived(
		!file_details || path === ''
			? file_details
			: [
					{
						name: '..',
						path: getParentDir(path),
						type: 'directory'
					},
					...file_details
				]
	);
	let waited_a_bit = $state(false);
	onMount(() => {
		setTimeout(() => {
			waited_a_bit = true;
		}, 1500);
	});
</script>

<div class="border-base-400 my-3 rounded-lg border">
	{#if path !== ''}
		<div class="border-base-400 bg-base-200 border-b px-6 py-1">
			<h4 class="">
				{#each path_structure as dir (dir)}
					/ {dir}
				{/each}
			</h4>
		</div>
	{/if}
	<div class="">
		{#if error}
			{error}
		{:else if !file_details_wrapper}
			{#if waited_a_bit}
				<div class="text-center text-wrap break-all opacity-50">
					{loading_msg}
				</div>
			{/if}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		{:else}
			<div class="overflow-x-auto">
				<table class="table-sm table">
					<!-- head -->
					<thead class="bg-base-200">
						<tr>
							<th></th>
							<th>Name</th>
						</tr>
					</thead>
					<tbody>
						{#each file_details_wrapper as f (`${f.path}/${f.name}`)}
							<tr class="hover:bg-base-200" class:bg-base-200={f.path === selected_file}>
								<th class="w-1">
									{#if f.type === 'directory'}
										<svg class="text-secondary h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
											<path
												d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"
											/>
										</svg>
									{:else}
										<svg
											class="text-base-content h-5 w-5 opacity-70"
											fill="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
											/>
										</svg>
									{/if}
								</th>
								<td> <a class="link-hover link" href={`${base_url}/${f.path}`}>{f.name}</a></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
