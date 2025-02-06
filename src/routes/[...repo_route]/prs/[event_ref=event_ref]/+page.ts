import { type EventBech32, type PrOrIssueRouteData, type RepoRouteData } from '$lib/types';

export const load = ({
	params,
	parent
}: {
	params: { event_ref: EventBech32 };
	parent: RepoRouteData;
}): PrOrIssueRouteData => {
	return { ...parent, event_ref: params.event_ref };
};
