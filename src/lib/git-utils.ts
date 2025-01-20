import type { NostrEvent } from 'nostr-tools';
import { getTagValue } from './utils';

export const isCoverLetter = (s: string): boolean => {
	return s.indexOf('PATCH 0/') > 0;
};
/** this doesn't work for all patch formats and options */
export const extractPatchMessage = (s: string): string | undefined => {
	try {
		if (isCoverLetter(s)) {
			return s.substring(s.indexOf('] ') + 2);
		}
		const t = s.split('Subject: [')[1].split('] ')[1];

		if (t.split('\n\n---\n ').length > 1) return t.split('\n\n---\n ')[0];
		return t.split('\n\ndiff --git ')[0].split('\n\n ').slice(0, -1).join('');
	} catch {
		return undefined;
	}
};

export const extractPatchTitle = (event: NostrEvent): string | undefined =>
	(
		getTagValue(event.tags, 'name') ??
		getTagValue(event.tags, 'description') ??
		extractPatchTitleFromContent(event.content) ??
		''
	)
		.split('/r')[0]
		.split('/n')[0];

/** this doesn't work for all patch formats and options */
const extractPatchTitleFromContent = (s: string): string | undefined => {
	const msg = extractPatchMessage(s);
	if (!msg) return undefined;
	return msg.split('\n')[0];
};

export const extractPatchDescription = (event: NostrEvent): string | undefined =>
	getTagValue(event.tags, 'description') ?? extractPatchDescriptionFromContent(event.content) ?? '';

/** patch message without first line */
const extractPatchDescriptionFromContent = (s: string): string | undefined => {
	const msg = extractPatchMessage(s);
	if (!msg) return '';
	const i = msg.indexOf('\n');
	if (i === -1) return '';
	return msg.substring(i).trim();
};

export const extractIssueTitle = (event: NostrEvent): string => {
	return getTagValue(event.tags, 'subject') || event.content.split('\n')[0] || '';
};

export const extractIssueDescription = (event: NostrEvent): string =>
	extractIssueDescriptionFromContent(event.content);

const extractIssueDescriptionFromContent = (s: string): string => {
	const split = s.split('\n');
	if (split.length === 0) return '';
	return s.substring(split[0].length) || '';
};
