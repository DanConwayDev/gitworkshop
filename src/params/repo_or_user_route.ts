import { isRepoRouteString, isUserRouteString, type RepoRouteString } from '$lib/types';
import type { ParamMatcher } from '@sveltejs/kit';

export const match = ((param: string): param is RepoRouteString => {
	return isRepoRouteString(param) || isUserRouteString(param);
}) satisfies ParamMatcher;
