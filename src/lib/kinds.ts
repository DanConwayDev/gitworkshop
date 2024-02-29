export const reply_kind: number = 1

export const proposal_status_open: number = 1630
export const proposal_status_applied: number = 1631
export const proposal_status_closed: number = 1632
export const proposal_status_draft: number = 1633
export const proposal_status_kinds: number[] = [
  proposal_status_open,
  proposal_status_applied,
  proposal_status_closed,
  proposal_status_draft,
]

export function statusKindtoText(
  kind: number,
  type: 'proposal' | 'issue'
): string {
  if (kind === proposal_status_open) return 'Open'
  if (type === 'proposal' && kind === proposal_status_applied) return 'Applied'
  if (type === 'issue' && kind === proposal_status_applied) return 'Resolved'
  if (kind === proposal_status_closed) return 'Closed'
  return 'Draft'
}

export const repo_kind: number = 30617

export const patch_kind: number = 1617

export const issue_kind: number = 1621
