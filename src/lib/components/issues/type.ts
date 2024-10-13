import type { TreeEvent } from '../events/type'
import type { Event } from 'nostr-tools'
import type { PubKeyString } from '$lib/dbs/types'

export interface IssueSummary {
  type: 'issue'
  title: string
  descritpion: string
  repo_a: string
  id: string
  comments: number
  status: undefined | number
  status_date: number
  author: PubKeyString | undefined
  created_at: number | undefined
  loading: boolean
}

export const summary_defaults: IssueSummary = {
  type: 'issue',
  title: '',
  descritpion: '',
  repo_a: '',
  id: '',
  comments: 0,
  status: undefined,
  status_date: 0,
  author: undefined,
  created_at: 0,
  loading: true,
}

export interface IssueSummaries {
  repo_a: string | undefined
  summaries: IssueSummary[]
  loading: boolean
}

export const summaries_defaults: IssueSummaries = {
  repo_a: '',
  summaries: [],
  loading: true,
}

export interface IssueFull {
  summary: IssueSummary
  issue_event: Event | undefined
  labels: string[]
  events: TreeEvent[]
  loading: boolean
}

export const full_defaults: IssueFull = {
  summary: { ...summary_defaults },
  issue_event: undefined,
  labels: [],
  events: [],
  loading: true,
}
