export const load = ({ params }: { params: { repo_id: string } }) => {
  return {
    repo_id: decodeURIComponent(params.repo_id),
  }
}

export const ssr = false
