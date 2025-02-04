export const reply_kind: number = 1;

export const StatusOpen = 1630;
export type StatusOpen = typeof StatusOpen;
export const StatusApplied = 1631;
export type StatusApplied = typeof StatusOpen;
export const StatusClosed = 1632;
export type StatusClosed = typeof StatusOpen;
export const StatusDraft = 1633;
export type StatusDraft = typeof StatusOpen;
export const Status = [StatusOpen, StatusApplied, StatusClosed, StatusDraft];
export type Status =
	| typeof StatusOpen
	| typeof StatusApplied
	| typeof StatusClosed
	| typeof StatusDraft;

export const status_kind_open: number = 1630;
export const status_kind_applied: number = 1631;
export const status_kind_closed: number = 1632;
export const status_kind_draft: number = 1633;
export const status_kinds: number[] = [
	status_kind_open,
	status_kind_applied,
	status_kind_closed,
	status_kind_draft
];

export function statusKindtoText(kind: number, type: 'pr' | 'issue'): string {
	if (kind === status_kind_open) return 'Open';
	if (type === 'pr' && kind === status_kind_applied) return 'Applied';
	if (type === 'issue' && kind === status_kind_applied) return 'Resolved';
	if (kind === status_kind_closed) return 'Closed';
	return 'Draft';
}

export const repo_kind: number = 30617;

export const patch_kind: number = 1617;

export const issue_kind: number = 1621;
export const Issue = 1621;
export type Issue = typeof Issue;
