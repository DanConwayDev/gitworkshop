import { extractRepoRoute, isRepoRouteString } from '$lib/types';

export const load = ({ params }: { params: { repo_route: string } }) => {
	return isRepoRouteString(params.repo_route)
		? {
				repo_route: extractRepoRoute(params.repo_route)
			}
		: { status: 404 };
};
