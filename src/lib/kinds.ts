import { EventDeletion, ShortTextNote, Zap } from 'nostr-tools/kinds';
import { DraftEvent, kindLabel } from './kind_labels';

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

export function kindtoTextLabel(kind: number): string {
	if (kind === FeedbackKind) return 'Feedback';
	if (kind === NostrWalletKind) return 'Nostr Wallet';
	if (kind === NostrWalletBackupKind) return 'Nostr Wallet Backup';
	if (kind === NostrWalletTokenKind) return 'Nostr Wallet Token';
	if (kind === NostrWalletSpendHistorynKind) return 'Nostr Wallet Spend History';
	return kindLabel(kind) ?? 'Unknown';
}

export const RepoAnnKind = 30617;
export type RepoAnnKind = typeof RepoAnnKind;

export const RepoStateKind = 30618;
export type RepoStateKind = typeof RepoStateKind;

export const PatchKind = 1617;
export type PatchKind = typeof PatchKind;

export const PrKind = 1618;
export type PrKind = typeof PrKind;

export const PrUpdateKind = 1618;
export type PrUpdateKind = typeof PrUpdateKind;

export const IssueKind = 1621;
export type IssueKind = typeof IssueKind;

export const FeedbackKind = 1314;
export type FeedbackKind = typeof FeedbackKind;

export const NostrWalletKind = 17375;
export type NostrWalletKind = typeof NostrWalletKind;

export const NostrWalletBackupKind = 375;
export type NostrWalletTBackupKind = typeof NostrWalletBackupKind;

export const NostrWalletTokenKind = 7375;
export type NostrWalletTokenKind = typeof NostrWalletTokenKind;

export const NostrWalletSpendHistorynKind = 7376;
export type NostrWalletSpendHistorynKind = typeof NostrWalletSpendHistorynKind;

export const ActionDvmRequestKind = 5600;
export type ActionDvmRequestKind = typeof ActionDvmRequestKind;

export const ActionDvmResponseKind = 6600;
export type ActionDvmResponseKind = typeof ActionDvmResponseKind;

export const LegacyGitReplyKind = 1622;
export type LegacyGitReplyKind = typeof LegacyGitReplyKind;

export const ReplyKind = 1111;
export type ReplyKind = typeof ReplyKind;

export const CommentKinds = [ShortTextNote, LegacyGitReplyKind, ReplyKind];
export type CommentKinds = typeof ShortTextNote | typeof LegacyGitReplyKind | typeof ReplyKind;

export const DeletionKind = EventDeletion;
export type DeletionKind = typeof DeletionKind;

export const QualityChildKinds = [...CommentKinds, Zap, PrUpdateKind];
export type QualityChildKinds = CommentKinds | typeof Zap;

// no nip but I've seen in the wild
export const NostrLanguangeClassificationKind = 9978;
export type NostrLanguangeClassificationKind = typeof NostrLanguangeClassificationKind;

export const IgnoreKinds = [NostrLanguangeClassificationKind, DraftEvent];
export type IgnoreKinds = typeof NostrLanguangeClassificationKind;
