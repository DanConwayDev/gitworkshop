import { extractRepoRoute, extractUserRoute, type RouteData } from '$lib/types';
import { redirect } from '@sveltejs/kit';

export const load = ({
	params,
	url
}: {
	params: { rest: string };
	url: string;
}): void => {
	const url_string = url.toString();

	// redirects
	if (params.rest.startsWith('r/')) {
		redirect(301, `/${params.rest.replace(new RegExp(`^r\\/`), '')}`);
	}
	if (params.rest.startsWith('p/')) {
		redirect(301, `/${params.rest.replace(new RegExp(`^p\\/`), '')}`);
	}
	if (params.rest.startsWith('e/')) {
		redirect(301, `/${params.rest.replace(new RegExp(`^e\\/`), '')}`);
	}

	// TODO redirect issue kind nevents to repo route
	// TODO redirect pr root kind nevents to repo route
	// TODO redirect responses to issues and prs to repo route
	// TODO redirect repo state announcements
	// TODO handle links to event that don't relate git stuff

};
