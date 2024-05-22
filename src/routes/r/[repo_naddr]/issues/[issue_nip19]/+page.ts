export const load = ({
  params,
}: {
  params: { issue_nip19: string; repo_naddr: string }
}) => {
  return {
    repo_naddr: decodeURIComponent(params.repo_naddr),
    issue_nip19: params.issue_nip19,
  }
}
