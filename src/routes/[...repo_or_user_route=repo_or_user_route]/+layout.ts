import {
	extractRepoRoute,
	extractUserRoute,
	type RepoRouteString,
	type RouteData
} from '$lib/types';

export const load = ({
	params,
	url
}: {
	params: { repo_or_user_route: RepoRouteString };
	url: string;
}): RouteData | undefined => {
	const url_string = url.toString();

	const repo_route = extractRepoRoute(params.repo_or_user_route);
	if (repo_route) {
		// pages with repo sidebar
		const with_repo_sidebar = ['', '/about', '/issues', '/prs'].some((page) =>
			url_string.endsWith(`${repo_route?.s}${page}`)
		);
		const show_sidebar_on_mobile = ['', '/about'].some((page) =>
			url_string.endsWith(`${repo_route?.s}${page}`)
		);

		return { url: url_string, repo_route, with_repo_sidebar, show_sidebar_on_mobile };
	}

	const user_route = extractUserRoute(params.repo_or_user_route);
	if (user_route) {
		// user sub-routes cannot be used as would be interpreted as a repo identifier
		return { url: url_string, user_route };
	}
	// other routes should be captured by [...rest]
};
