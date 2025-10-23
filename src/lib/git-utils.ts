import { getEventHash, nip19, type NostrEvent } from 'nostr-tools';
import { getRootUuid, getTagValue } from './utils';
import {
	getIssueOrPrStatus,
	isEventIdString,
	isRepoRef,
	isWebSocketUrl,
	type ChildEventRef,
	type EventIdString,
	type IssueOrPRTableItem,
	type RepoRef,
	type RepoRoute,
	type StatusHistoryItem,
	type WebSocketUrl
} from './types';
import { PrKind, QualityChildKinds } from './kinds';
import {
	isGitManagerLogEntryGlobal,
	isGitManagerLogEntryServer,
	type GitManagerLogEntry,
	type GitManagerLogEntryGlobal,
	type GitManagerLogEntryServer,
	type GitProgressObj,
	type GitProgressPhase,
	type GitServerState
} from './types/git-manager';

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
		.split('\r')[0]
		.split('\n')[0];

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

export const repoRouteToNostrUrl = (repo_route: RepoRoute): string => {
	if (repo_route.type === 'nip05') {
		if (repo_route.nip05.includes('@'))
			return `nostr://${repo_route.nip05}/${repo_route.identifier}`;
		else return `nostr://_@${repo_route.nip05}/${repo_route.identifier}`;
	}
	const relay_hint = repo_route?.relays?.[0]
		? `/${encodeURIComponent(repo_route.relays[0].replace('wss://', ''))}`
		: '';
	return `nostr://${nip19.npubEncode(repo_route.pubkey)}${relay_hint}/${repo_route.identifier}`;
};

export const extractRepoRefsFromPrOrIssue = (
	event: NostrEvent
): { a_ref: RepoRef; relays: WebSocketUrl[] }[] =>
	event.tags.flatMap((t) =>
		t[1] && t[0] === 'a' && isRepoRef(t[1])
			? [{ a_ref: t[1], relays: t[2] && isWebSocketUrl(t[2]) ? [t[2]] : [] }]
			: []
	);

export const extractRootIdIfNonReplaceable = (event: NostrEvent) => {
	const root = getRootUuid(event);
	if (root && isEventIdString(root)) return root;
	return undefined;
};

export const eventToStatusHistoryItem = (event?: NostrEvent): StatusHistoryItem | undefined => {
	if (!event) return undefined;
	const status = getIssueOrPrStatus(event.kind);
	if (!status) return undefined;
	const { id, pubkey, created_at } = event;
	return { uuid: id, pubkey, created_at, status };
};

export const eventToQualityChild = (event?: NostrEvent): ChildEventRef | undefined => {
	if (!event || !QualityChildKinds.filter((k) => k !== PrKind).includes(event.kind))
		return undefined;
	const { id, kind, pubkey } = event;
	return { id, kind, pubkey };
};

export const deletionRelatedToIssueOrPrItem = (
	deletion: NostrEvent,
	item: IssueOrPRTableItem
): EventIdString[] => {
	return deletion.tags
		.filter((t) => t.length > 1 && t[0] === 'e')
		.map((t) => t[1])
		.filter(
			(id) =>
				id === item.uuid ||
				item.deleted_ids.includes(id) ||
				item.quality_children.some((c) => c.id === id) ||
				item.status_history.some((h) => h.uuid === id)
		);
};

export const refsToBranches = (refs: string[][]) =>
	refs.filter((r) => r[0].startsWith('refs/heads/')).map((r) => r[0].replace('refs/heads/', ''));
export const refsToTags = (refs: string[][]) =>
	refs
		.filter((r) => r[0].startsWith('refs/tags/'))
		.map((r) => r[0].replace('refs/tags/', ''))
		.sort((a, b) => b.localeCompare(a));

export const hashCloneUrl = (url: string): string => {
	// using nostr-tools sha256 hashing dependancy without a seperate import
	return getEventHash({
		pubkey: '0'.repeat(64),
		kind: 1,
		content: url,
		tags: [],
		created_at: 0
	}).slice(0, 8);
};

export function cloneUrlToRemoteName(url: string) {
	return hashCloneUrl(url);
}

export function remoteNameToCloneUrl(name: string, clone_urls: string[]) {
	return clone_urls.find((url) => cloneUrlToRemoteName(url) == name);
}

export function cloneUrlToShortName(url: string) {
	const sanitizeDomain = (d: string) =>
		d
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, '')
			.replace(/^ssh:\/\//, '')
			.replace(/\/.*$/, '');
	const extractDomain = (u: string) => {
		if (!u) return '';
		// SCP-like "git@host:owner/repo.git"
		const scp = u.match(/^[^@]+@([^:/]+)[:/]/);
		if (scp) return sanitizeDomain(scp[1]);
		try {
			const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u) ? u : 'ssh://' + u;
			return sanitizeDomain(new URL(withProto).hostname || '');
		} catch {
			// fallback: take up to first slash or colon
			return sanitizeDomain(u.split(/[/:]/)[0]);
		}
	};
	return extractDomain(url);
}

export function remoteNameToShortName(name: string, clone_urls: string[]) {
	const url = remoteNameToCloneUrl(name, clone_urls);
	if (url) return cloneUrlToShortName(url);
	return name;
}

// Overload: Get server log entry for a specific server
export function getGitLog(
	logs: GitManagerLogEntry[],
	sub_filter: string[],
	server: string,
	clone_urls: string[]
): GitManagerLogEntryServer | undefined;

// Overload: Get global log entry
export function getGitLog(
	logs: GitManagerLogEntry[],
	sub_filter?: string[]
): GitManagerLogEntryGlobal | undefined;

// Implementation
export function getGitLog(
	logs: GitManagerLogEntry[],
	sub_filter: string[] = [],
	server?: string,
	clone_urls?: string[]
): GitManagerLogEntryServer | GitManagerLogEntryGlobal | undefined {
	if (server !== undefined && clone_urls !== undefined) {
		let remote = server;
		if (server.length !== 8) remote = cloneUrlToRemoteName(server);
		// Server-specific log entry
		for (let i = logs.length - 1; i >= 0; i--) {
			const entry = logs[i];
			if (
				isGitManagerLogEntryServer(entry) &&
				entry.remote === remote &&
				(!sub_filter.length || !entry.sub || sub_filter.includes(entry.sub))
			) {
				return entry;
			}
		}
		return undefined;
	} else {
		// Global log entry
		for (let i = logs.length - 1; i >= 0; i--) {
			const entry = logs[i];
			if (
				isGitManagerLogEntryGlobal(entry) &&
				(!sub_filter || !sub_filter.length || !entry.sub || sub_filter.includes(entry.sub))
			) {
				return entry;
			}
		}
		return undefined;
	}
}

export const getLatestLogFromEachServer = (
	git_logs: GitManagerLogEntry[] = [],
	sub_filter: string[] = [],
	clone_urls: string[]
): GitManagerLogEntryServer[] => {
	// Deduplicate clone_urls
	const unique_clone_urls = [...new Set(clone_urls)];

	const server_latest_log: GitManagerLogEntryServer[] = [];
	unique_clone_urls.forEach((url) => {
		const s = getGitLog(git_logs, sub_filter, url, unique_clone_urls);
		if (s) server_latest_log.push(s);
	});
	return server_latest_log;
};

export const getOveralGitServerStatus = (
	git_logs: GitManagerLogEntry[] = [],
	sub_filter: string[] = ['explorer'],
	clone_urls: string[]
): GitServerState | undefined => {
	const server_latest_log = getLatestLogFromEachServer(git_logs, sub_filter, clone_urls);
	if (server_latest_log.some((e) => e.state === 'connecting')) return 'connecting';
	if (server_latest_log.some((e) => e.state === 'connected')) return 'connected';
	if (server_latest_log.some((e) => e.state === 'fetching')) return 'fetching';
	if (server_latest_log.some((e) => e.state === 'fetched')) return 'fetched';
	if (server_latest_log.some((e) => e.state === 'failed')) return 'failed';
};

export const onLogUpdateGitStatus = (
	entry: GitManagerLogEntry,
	sub_filter?: string[]
): GitManagerLogEntryGlobal | undefined => {
	if (
		isGitManagerLogEntryGlobal(entry) &&
		(!sub_filter || !entry.sub || sub_filter.includes(entry.sub))
	) {
		return { ...entry };
	}
	return undefined;
};

export const serverStatustoMsg = (log: GitManagerLogEntryServer) => {
	if (log.msg) return log.msg;
	if (!log.progress) return '';
	if (log.progress.phase === 'Downloading data') {
		return log.progress.total
			? `Downloading ${(log.progress.loaded / 1024).toFixed(1)} MB of ${(log.progress.total / 1024).toFixed(1)} MB`
			: `Downloading ${(log.progress.loaded / 1024).toFixed(1)} MB`;
	}
	return `${log.progress.phase} ${log.progress.loaded}/${log.progress.total}`;
};

export const gitProgressToPc = (progress: GitProgressObj): number => {
	const phasePercentages: { [key in GitProgressPhase]: number } = {
		'Counting objects': 3,
		'Compressing objects': 7,
		'Downloading data': 70,
		'Receiving objects': 15,
		'Resolving deltas': 5
	};

	const { phase, loaded, total } = progress;

	// Inner function to calculate total percentage from completed phases
	const getPreviousPhasesCompletion = (currentPhase: GitProgressPhase): number => {
		let completion = 0;
		const phasesOrder = [
			'Counting objects',
			'Compressing objects',
			'Downloading data',
			'Receiving objects',
			'Resolving deltas'
		];

		for (const p of phasesOrder) {
			if (p === currentPhase) break;
			completion += phasePercentages[p];
		}

		return completion;
	};

	if (phase in phasePercentages) {
		return Math.min(
			Math.floor((loaded / (total || Math.max(50 * 1024, loaded))) * phasePercentages[phase]) +
				getPreviousPhasesCompletion(phase),
			100
		);
	}

	// If the phase is not recognized or invalid, return 0
	return 0;
};

// assumes that the item with the most progress is doing the clone and therefore is 90% of the work
export const gitProgressesToPc = (progresses: GitProgressObj[]): number => {
	// give the highest 90% and split the remaining 10% among the others

	const pcs = progresses.map(gitProgressToPc); // numbers in 0-100
	if (pcs.length === 0) return 0;

	const biggest = Math.max(...pcs);

	// collect the others (exclude one instance of the biggest)
	const others: number[] = [];
	let removed = false;
	for (const p of pcs) {
		if (!removed && p === biggest) {
			removed = true;
			continue;
		}
		others.push(p);
	}

	// average of others (if none, treat average as 0)
	const avgOthers = others.length ? others.reduce((s, v) => s + v, 0) / others.length : 0;

	// biggest contributes 90% of its progress, others collectively contribute 10% of their average
	const total = biggest * 0.9 + avgOthers * 0.1;

	return Math.floor(Math.max(0, Math.min(100, total)));
};

/**
 * Calculate weighted progress based on sub filters
 * Explorer sub (default branch) is weighted at 90%, other subs at 10%
 * Progress is monotonic - never decreases
 */
const progressCache = new Map<string, number>();

export const gitProgressesBySub = (
	git_logs: GitManagerLogEntry[] = [],
	sub_filter: string[] = [],
	clone_urls: string[]
): number => {
	// Create unique cache key for this combination
	const cacheKey = `${sub_filter.sort().join(',')}:${clone_urls.sort().join(',')}`;
	const lastProgress = progressCache.get(cacheKey) || 0;

	if (sub_filter.length === 0) {
		// No sub filters, use the standard approach
		const server_latest_log = getLatestLogFromEachServer(git_logs, sub_filter, clone_urls);
		const progress = gitProgressesToPc(
			server_latest_log.flatMap((s) => (s && s.progress ? [s.progress] : []))
		);
		const newProgress = Math.max(lastProgress, progress);
		progressCache.set(cacheKey, newProgress);
		return newProgress;
	}

	// Separate explorer from other subs
	const explorerSub = 'explorer';
	const isExplorer = sub_filter.includes(explorerSub);
	const otherSubs = sub_filter.filter((s) => s !== explorerSub);

	let explorerPc = 0;
	let othersPc = 0;

	// Calculate explorer progress (weighted at 90%)
	if (isExplorer) {
		const explorerLogs = getLatestLogFromEachServer(git_logs, [explorerSub], clone_urls);

		// Filter out failed servers - they shouldn't affect progress
		const activeExplorerLogs = explorerLogs.filter((log) => log.state !== 'failed');

		// Check if ANY server has completed explorer fetch
		const hasCompletedExplorer = activeExplorerLogs.some((log) => log.state === 'fetched');

		if (hasCompletedExplorer) {
			// Lock at 100% once any server completes to prevent regression
			explorerPc = 100;
		} else {
			// Use the max progress among all active servers for explorer
			const explorerProgresses = activeExplorerLogs.flatMap((s) =>
				s && s.progress ? [s.progress] : []
			);
			if (explorerProgresses.length > 0) {
				explorerPc = Math.max(...explorerProgresses.map(gitProgressToPc));
			}
		}
	}

	// Calculate other subs progress (weighted at 10%)
	if (otherSubs.length > 0) {
		const otherLogs = getLatestLogFromEachServer(git_logs, otherSubs, clone_urls);

		// Filter out failed servers - they shouldn't affect progress
		const activeOtherLogs = otherLogs.filter((log) => log.state !== 'failed');

		// Check if ANY server has completed the other subs
		const hasCompletedOthers = activeOtherLogs.some((log) => log.state === 'fetched');

		if (hasCompletedOthers) {
			// Lock at 100% once any server completes
			othersPc = 100;
		} else {
			// Use the max progress among all active servers for other subs
			const otherProgresses = activeOtherLogs.flatMap((s) => (s && s.progress ? [s.progress] : []));
			if (otherProgresses.length > 0) {
				othersPc = Math.max(...otherProgresses.map(gitProgressToPc));
			}
		}
	}

	// Weight: 90% for explorer, 10% for others
	const weighted = explorerPc * 0.9 + othersPc * 0.1;
	const current = Math.floor(Math.max(0, Math.min(100, weighted)));

	// Ensure monotonic progress - never go backwards
	const newProgress = Math.max(lastProgress, current);
	progressCache.set(cacheKey, newProgress);
	return newProgress;
};

/**
 * Get descriptive status message based on current fetch state
 */
export const getFetchStatusMessage = (
	git_logs: GitManagerLogEntry[] = [],
	sub_filter: string[] = [],
	clone_urls: string[],
	infos?: unknown[]
): string => {
	const explorerSub = 'explorer';
	const isExplorer = sub_filter.includes(explorerSub);
	const otherSubs = sub_filter.filter((s) => s !== explorerSub);

	// Check if we have commit data loaded
	if (infos && infos.length > 0) {
		return 'loading commit details';
	}

	// Check explorer status
	if (isExplorer) {
		const explorerLogs = getLatestLogFromEachServer(git_logs, [explorerSub], clone_urls);
		const hasCompletedExplorer = explorerLogs.some((log) => log.state === 'fetched');
		const isFetchingExplorer = explorerLogs.some((log) => log.state === 'fetching');

		if (!hasCompletedExplorer && isFetchingExplorer) {
			return 'fetching default branch data';
		}
	}

	// Check other subs status
	if (otherSubs.length > 0) {
		const otherLogs = getLatestLogFromEachServer(git_logs, otherSubs, clone_urls);
		const isFetchingOthers = otherLogs.some((log) => log.state === 'fetching');

		if (isFetchingOthers) {
			return 'fetching commit data';
		}
	}

	// Check if everything is complete
	const allLogs = getLatestLogFromEachServer(git_logs, sub_filter, clone_urls);
	const allFetched = allLogs.length > 0 && allLogs.every((log) => log.state === 'fetched');

	if (allFetched) {
		return 'data fetched';
	}

	// Default fallback
	return 'fetching commits';
};
