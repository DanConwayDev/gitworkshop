export const load = ({ params }: { params: { repo_identifier: string } }) => {
  return {
    repo_identifier: params.repo_identifier,
  }
}

export const ssr = false
