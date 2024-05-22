export const load = ({ params }: { params: { repo_naddr: string } }) => {
  return {
    repo_naddr: params.repo_naddr,
  }
}

export const ssr = false
