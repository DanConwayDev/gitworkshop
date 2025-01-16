import { naddrToRepoA } from '$lib/utils';

export const load = ({ params }: { params: { naddr_end: string | undefined } }) => {
	let a_ref = undefined;
	if (params.naddr_end) {
		a_ref = naddrToRepoA(`naddr${params.naddr_end}`);
	}
	return {
		a_ref
	};
};
