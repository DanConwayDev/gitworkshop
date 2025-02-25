<script lang="ts">
	import {
		StatusAppliedKind,
		StatusClosedKind,
		StatusDraftKind,
		StatusOpenKind,
		statusKindtoText
	} from '$lib/kinds';
	import { IssueOrPrStatus } from '$lib/types';
	import { issue_icon_path } from '../issues/icons';
	import { pr_icon_path } from '../prs/icons';

	let {
		status = IssueOrPrStatus.Open,
		type,
		deleted = false,
		edit_mode = false,
		xs = false
	}: {
		status: IssueOrPrStatus;
		type: 'pr' | 'issue';
		deleted?: boolean;
		edit_mode?: boolean;
		xs?: boolean;
	} = $props();
</script>

{#if !status}
	<div class="skeleton inline-block h-8 w-24 rounded-md align-middle"></div>
{:else}
	<div
		tabIndex={0}
		role="button"
		class:btn-success={!deleted && status && status === StatusOpenKind}
		class:btn-primary={!deleted && status && status === StatusAppliedKind}
		class:btn-neutral={deleted ||
			!status ||
			status === StatusDraftKind ||
			status === StatusClosedKind}
		class:cursor-default={!edit_mode}
		class:no-animation={!edit_mode}
		class:hover:bg-success={!deleted && !edit_mode && status && status === StatusOpenKind}
		class:hover:bg-primary={!deleted && !edit_mode && status && status === StatusAppliedKind}
		class:hover:bg-neutral={deleted ||
			(!edit_mode && status && status === StatusDraftKind) ||
			status === StatusClosedKind}
		class:btn-xs={xs}
		class:btn-sm={!xs}
		class="btn btn-success align-middle"
	>
		{#if deleted}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class:pt-1={!xs}
				class:h-4={xs}
				class:w-4={xs}
				class:h-5={!xs}
				class:w-5={!xs}
				class="flex-none fill-neutral-content"
			>
				{#if type === 'pr'}
					<path d={pr_icon_path.close} />
				{:else if type === 'issue'}
					{#each issue_icon_path.closed as p}
						<path d={p} />
					{/each}
				{/if}
			</svg>
			Deleted
		{:else if status === StatusOpenKind}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 18 18"
				class:h-4={xs}
				class:w-4={xs}
				class:h-5={!xs}
				class:w-5={!xs}
				class="flex-none fill-success-content"
			>
				{#if type === 'pr'}
					<path d={pr_icon_path.open_patch} />
				{:else if type === 'issue'}
					{#each issue_icon_path.open as p}
						<path d={p} />
					{/each}
				{/if}
			</svg>
			{statusKindtoText(StatusOpenKind, type)}
		{:else if status === StatusAppliedKind}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class:pt-1={!xs}
				class:h-4={xs}
				class:w-4={xs}
				class:h-5={!xs}
				class:w-5={!xs}
				class="flex-none fill-primary-content"
			>
				{#if type === 'pr'}
					<path d={pr_icon_path.applied} />
				{:else if type === 'issue'}
					{#each issue_icon_path.resolved as p}
						<path d={p} />
					{/each}
				{/if}
			</svg>
			{statusKindtoText(StatusAppliedKind, type)}
		{:else if status === StatusClosedKind}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class:pt-1={!xs}
				class:h-4={xs}
				class:w-4={xs}
				class:h-5={!xs}
				class:w-5={!xs}
				class="flex-none fill-neutral-content"
			>
				{#if type === 'pr'}
					<path d={pr_icon_path.close} />
				{:else if type === 'issue'}
					{#each issue_icon_path.closed as p}
						<path d={p} />
					{/each}
				{/if}
			</svg>
			{statusKindtoText(StatusClosedKind, type)}
		{:else if status === StatusDraftKind}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class:pt-1={!xs}
				class:h-4={xs}
				class:w-4={xs}
				class:h-5={!xs}
				class:w-5={!xs}
				class="flex-none fill-neutral-content"><path d={pr_icon_path.draft} /></svg
			>
			{statusKindtoText(StatusDraftKind, type)}
		{:else}
			{status}
		{/if}
		{#if edit_mode}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				class="h-5 w-5 flex-none fill-success-content"
				><path
					fill="currentColor"
					d="M11.646 15.146L5.854 9.354a.5.5 0 0 1 .353-.854h11.586a.5.5 0 0 1 .353.854l-5.793 5.792a.5.5 0 0 1-.707 0"
				/></svg
			>
		{/if}
	</div>
{/if}
