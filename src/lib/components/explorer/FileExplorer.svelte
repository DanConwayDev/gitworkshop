<script lang="ts">
	import store from '$lib/store.svelte';
	import type { FileEntry } from '$lib/types/git-manager';
	import FileIcon from '../FileIcon.svelte';

	let {
		path,
		file_details,
		base_url,
		error
	}: { path: string; file_details?: FileEntry[]; error?: string; base_url: string } = $props();

	let path_structure = $derived(path.split('/'));
</script>

<div class="my-3 rounded-lg border border-base-400">
	{#if path !== ''}
		<div class="border-b border-base-400 bg-base-200 px-6 py-1">
			<h4 class="">
				{#each path_structure as dir}
					/ {dir}
				{/each}
			</h4>
		</div>
	{/if}
	<div class="">
		{#if error}
			{error}
		{:else if !file_details}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		{:else}
			<div class="overflow-x-auto">
				<table class="table table-sm">
					<!-- head -->
					<thead class="bg-base-200">
						<tr>
							<th></th>
							<th>Name</th>
						</tr>
					</thead>
					<tbody>
						{#each file_details as f}
							<tr class="hover:bg-base-200">
								<th class="w-1"><FileIcon isDirectory={f.type == 'directory'} path={f.path} /></th>
								<td> <a class="link-hover link" href={`${base_url}/${f.path}`}>{f.name}</a></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
