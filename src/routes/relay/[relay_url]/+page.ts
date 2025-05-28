export const load = ({ params }: { params: { relay_url: string } }): { relay_url: string } => {
	return { relay_url: params.relay_url };
};
