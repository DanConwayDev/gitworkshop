export const load = ({
  params,
}: {
  params: { proposal_nip19: string; repo_naddr: string }
}) => {
  return {
    repo_naddr: decodeURIComponent(params.repo_naddr),
    proposal_nip19: params.proposal_nip19,
  }
}
