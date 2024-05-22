import { redirect } from '@sveltejs/kit'

export const load = ({ params }: { params: { event_id: string } }) => {
  throw redirect(301, `/e/${params.event_id}`)
}
