import { ShortTextNote, Zap } from 'nostr-tools/kinds';

export const reply_kind: number = 1;

export const StatusOpenKind = 1630;
export type StatusOpenKind = typeof StatusOpenKind;
export const StatusAppliedKind = 1631;
export type StatusAppliedKind = typeof StatusOpenKind;
export const StatusClosedKind = 1632;
export type StatusClosedKind = typeof StatusOpenKind;
export const StatusDraftKind = 1633;
export type StatusDraftKind = typeof StatusOpenKind;
export const StatusKinds = [StatusOpenKind, StatusAppliedKind, StatusClosedKind, StatusDraftKind];
export type StatusKinds =
	| typeof StatusOpenKind
	| typeof StatusAppliedKind
	| typeof StatusClosedKind
	| typeof StatusDraftKind;

export function statusKindtoText(kind: number, type: 'pr' | 'issue'): string {
	if (kind === StatusOpenKind) return 'Open';
	if (type === 'pr' && kind === StatusAppliedKind) return 'Applied';
	if (type === 'issue' && kind === StatusAppliedKind) return 'Resolved';
	if (kind === StatusClosedKind) return 'Closed';
	return 'Draft';
}

export const RepoAnnKind = 30617;
export type RepoAnnKind = typeof RepoAnnKind;

export const RepoStateKind = 30618;
export type RepoStateKind = typeof RepoStateKind;

export const PatchKind = 1617;
export type PatchKind = typeof PatchKind;

export const IssueKind = 1621;
export type IssueKind = typeof IssueKind;

export const ActionDvmKind = 6900;
export type ActionDvmKind = typeof ActionDvmKind;

export const LegacyGitReplyKind = 1622;
export type LegacyGitReplyKind = typeof LegacyGitReplyKind;

export const CommentKinds = [ShortTextNote, LegacyGitReplyKind];
export type CommentKinds = typeof ShortTextNote | typeof LegacyGitReplyKind;

export const QualityChildKinds = [...CommentKinds, Zap];
export type QualityChildKinds = CommentKinds | typeof Zap;
