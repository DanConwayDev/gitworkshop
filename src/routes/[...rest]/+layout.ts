import { extractRepoRoute, extractUserRoute, type RouteData } from '$lib/types';
import { redirect } from '@sveltejs/kit';
import { nip19 } from 'nostr-tools';

export const load = ({
	params,
	url
}: {
	params: { rest: string };
	url: string;
}): { rest: string } => {
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
	return { rest: params.rest}
};
