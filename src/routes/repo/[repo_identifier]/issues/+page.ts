import { redirect } from '@sveltejs/kit'

export const load = ({ params }: { params: { repo_identifier: string } }) => {
  throw redirect(301, `/repo/${params.repo_identifier}`)
}
