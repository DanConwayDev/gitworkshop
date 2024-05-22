export const load = ({ params }: { params: { nostr_ref: string } }) => {
  return {
    nostr_ref: params.nostr_ref,
  }
}
