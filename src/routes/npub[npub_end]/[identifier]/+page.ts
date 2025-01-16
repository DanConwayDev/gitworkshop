export const load = ({ params }: { params: { naddr_end: string } }) => {
	return {
		repo_naddr: `naddr${params.naddr_end}`
	};
};
