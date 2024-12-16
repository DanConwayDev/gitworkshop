async function processStatusEvent(event: Event): Promise<boolean> {
  const entity_id = getTagValue(event.tags, 'e')
  if (!entity_id) return true
  let record = await db.issues.get(entity_id)
  let table: 'issues' | 'prs' = 'issues'
  if (!record) {
    record = await db.prs.get(entity_id)
    table = 'prs'
  }
  if (!record) return false
  const ref = eventToStatusRef(event)
  if (record.status_refs.some((r) => ref.uuid === r.uuid)) return true
  record.status_refs.push(ref)
  record.status_refs.sort((a, b) => a.created_at - b.created_at)
  record.status =
    record.status_refs.map((s) => s.status).slice(-1)[0] || IssueOrPrStatus.Open
  db[table].put(record, entity_id)
  return true
}

export default processStatusEvent
