import type { User } from '../users/type'
import { defaults as user_defaults } from '../users/type'
import type { Event } from '../events/type'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

export interface PRSummary {
  title: string
  descritpion: string
  repo_id: string
  id: string
  comments: number
  status: undefined | PRStatus
  status_date: number
  author: User
  created_at: number | undefined
  loading: boolean
}

export const summary_defaults: PRSummary = {
  title: '',
  descritpion: '',
  repo_id: '',
  id: '',
  comments: 0,
  status: undefined,
  status_date: 0,
  author: { ...user_defaults },
  created_at: 0,
  loading: true,
}

export interface PRSummaries {
  id: string
  summaries: PRSummary[]
  loading: boolean
}

export const summaries_defaults: PRSummaries = {
  id: '',
  summaries: [],
  loading: true,
}

export type PRStatus = 'Draft' | 'Open' | 'Merged' | 'Closed'

export function isPRStatus(
  potential_status: string | undefined
): potential_status is PRStatus {
  return (
    !!potential_status &&
    (potential_status == 'Draft' ||
      potential_status == 'Open' ||
      potential_status == 'Merged' ||
      potential_status == 'Closed')
  )
}
export interface PRFull {
  summary: PRSummary
  pr_event: NDKEvent | undefined
  labels: string[]
  events: Event[]
  loading: boolean
}

export const full_defaults: PRFull = {
  summary: { ...summary_defaults },
  pr_event: undefined,
  labels: [],
  events: [],
  loading: true,
}
