import { NGIT_VERSION } from '$lib/constants';
import { redirect } from '@sveltejs/kit';

export const load = ({ params }: { params: { file: string } }): { file: string } => {
	const version = NGIT_VERSION;
	const osList = ['ubuntu', 'macos', 'windows'];
	let found = false;

	for (const os of osList) {
		const s = params.file.split(`ngit-latest-${os}-`);
		if (s[1] && s[1].length > 0) {
			found = true;
			throw redirect(
				301,
				`https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-${os}-${s[1]}`
			);
		}
	}

	if (!found) {
		throw redirect(301, `/not-found`);
	}
};
