import {
  extractIssueTitle,
  extractPatchMessage,
} from '$lib/components/events/content/utils'
import { issue_kind, patch_kind, repo_kind } from '$lib/kinds'
import { base_relays } from '$lib/stores/ndk'
import {
  getTagMultiValue,
  getTagValue,
  getValueOfEachTagOccurence,
} from '$lib/utils'
import { isHexKey, type ProfileContent } from 'applesauce-core/helpers'
import { nip19, type Event } from 'nostr-tools'
import { naddrEncode, npubEncode, type AddressPointer } from 'nostr-tools/nip19'

export type AtLeastThreeArray<T> = [T, T, T, ...T[]]
export type PubKeyString = string
export type Npub = `npub1${string}`
type Timestamp = number
type Kind = number
export type EventIdString = string
export type ARef = `${number}:${PubKeyString}:${string}`

export const isARef = (a: string | ARef): a is ARef => {
  const s = a.split(':')
  if (s.length !== 3) return false
  return s.every((v) => v.length > 0)
}

interface RepoAnnBaseFields {
  identifier: string
  unique_commit: string | undefined
  name: string
  description: string
  clone: string[]
  web: string[]
  tags: string[]
  maintainers: PubKeyString[]
  relays: string[]
}

interface EventAttribution {
  uuid: EventIdString | ARef
  event_id: EventIdString | undefined // used if uuid is ARef
  author: PubKeyString
  created_at: Timestamp
}

export interface RepoAnn extends RepoAnnBaseFields, EventAttribution {}

export interface RepoAnnCollection extends RepoAnnBaseFields, EventAttribution {
  trusted_maintainer: string
  trusted_maintainer_event_id: EventIdString
  trusted_maintainer_event_created_at: Timestamp
  // maintainers: string[] recursive maintainers
}

export type RepoSummarisable = (RepoAnn | AddressPointer | RepoAnnCollection) &
  Partial<SeenOn & WithNaddr>

export type Naddr = `naddr1${string}`

export function repoToNaddr<T extends AddressPointer>(
  repo: T | RepoAnn | RepoAnnCollection
): Naddr {
  const pubkey =
    (repo as RepoAnnCollection).trusted_maintainer ||
    (repo as EventAttribution).author ||
    (repo as AddressPointer).pubkey

  return naddrEncode({
    kind: repo_kind,
    identifier: repo.identifier,
    pubkey,
    relays:
      repo.relays && repo.relays.length > 0 ? [repo.relays[0]] : undefined,
  })
}

export type SelectedRepoCollection =
  | (RepoAnnCollection & WithNaddr)
  | (AddressPointer & AndLoading & WithNaddr)
  | undefined

export const selectedRepoIsAddressPointerWithLoading = (
  selected_repo: SelectedRepoCollection
): selected_repo is AddressPointer & AndLoading & WithNaddr => {
  return !!selected_repo && 'loading' in selected_repo
}

export const isRepoLoading = (selected_repo: SelectedRepoCollection) => {
  if (selectedRepoIsAddressPointerWithLoading(selected_repo))
    return selected_repo.loading
  else return false
}
export function repoToARef<T extends AddressPointer>(
  repo: T | RepoAnn | RepoAnnCollection
): ARef {
  const pubkey =
    (repo as RepoAnnCollection).trusted_maintainer ||
    (repo as EventAttribution).author ||
    (repo as AddressPointer).pubkey
  return `${repo_kind}:${pubkey}:${repo.identifier}`
}

export function repoToARefs<T extends AddressPointer>(
  repo: T | RepoAnn | RepoAnnCollection
): ARef[] {
  const maintainers = new Set()
  const pubkey =
    (repo as RepoAnnCollection).trusted_maintainer ||
    (repo as EventAttribution).author ||
    (repo as AddressPointer).pubkey
  maintainers.add(pubkey)
  if ('maintainers' in repo) {
    repo.maintainers.forEach((m) => maintainers.add(m))
  }
  return [...maintainers].map(
    (m) => `${repo_kind}:${m}:${repo.identifier}`
  ) as ARef[]
}

export const selectedRepoCollectionToName = (
  selected_repo: SelectedRepoCollection
): string => {
  if (!selected_repo) return ''
  return 'name' in selected_repo ? selected_repo.name : selected_repo.identifier
}

export const selectedRepoCollectionToLeadMaintainer = (
  selected_repo: Exclude<SelectedRepoCollection, undefined>
): PubKeyString => {
  if ('trusted_maintainer' in selected_repo)
    return selected_repo.trusted_maintainer
  if ('pubkey' in selected_repo) return selected_repo.pubkey
  // should never get here
  return ''
}

export const selectedRepoCollectionToMaintainers = (
  selected_repo: Exclude<SelectedRepoCollection, undefined>
): PubKeyString[] => {
  const maintainers = [selectedRepoCollectionToLeadMaintainer(selected_repo)]

  if ('maintainers' in selected_repo)
    selected_repo.maintainers.forEach((m) => {
      if (!maintainers.includes(m)) {
        maintainers.push(m)
      }
    })
  return maintainers
}

export const selectedRepoCollectionToRelays = (
  selected_repo: SelectedRepoCollection
): string[] => {
  return !selected_repo || !selected_repo.relays
    ? [...base_relays]
    : [
        ...(selected_repo.relays.length > 3
          ? selected_repo.relays
          : [...base_relays].concat(selected_repo.relays)),
      ]
}

export const eventToRepoAnn = (event: Event): RepoAnn | undefined => {
  if (event.kind !== repo_kind) return undefined

  const maintainers = [event.pubkey]
  getTagMultiValue(event.tags, 'maintainers')?.forEach((v, i) => {
    if (i > 0 && v !== maintainers[0]) {
      try {
        nip19.npubEncode(v) // will throw if invalid hex pubkey
        maintainers.push(v)
      } catch {}
    }
  })
  const relays: string[] = []
  getTagMultiValue(event.tags, 'relays')?.forEach((v, i) => {
    if (i > 0) {
      relays.push(v)
    }
  })
  const web: string[] = []
  getTagMultiValue(event.tags, 'web')?.forEach((v, i) => {
    if (i > 0) {
      web.push(v)
    }
  })
  const clone: string[] = []
  getTagMultiValue(event.tags, 'clone')?.forEach((v, i) => {
    if (i > 0) {
      clone.push(v)
    }
  })
  const identifier = getTagValue(event.tags, 'd') || ''
  return {
    uuid: `${repo_kind}:${event.pubkey}:${identifier}`,
    event_id: event.id,
    author: event.pubkey,
    identifier,
    unique_commit: event.tags.find((t) => t[2] && t[2] === 'euc')?.[1],
    name: getTagValue(event.tags, 'name') || '',
    description: getTagValue(event.tags, 'description') || '',
    clone,
    web,
    tags: getValueOfEachTagOccurence(event.tags, 't'),
    maintainers,
    relays,
    created_at: event.created_at,
  }
}

interface EventRefBase extends EventAttribution {
  kind: Kind
  parent_id: (EventIdString | ARef)[]
}

export interface SeenOnRelay {
  last_check: Timestamp
  seen: boolean
  up_to_date: boolean
}
export interface SeenOn {
  seen_on: Map<string, SeenOnRelay>
}

export interface AndLoading {
  loading: boolean
}

export interface LastCheck {
  url_and_query: string
  url: string
  timestamp: Timestamp
  query: PubKeyString | 'All Repos' | 'All'
}

// interface EventRefParamReplaceable extends EventRefBase {
//   identifier: string
// }

interface PrRevisionRef extends EventRefBase {
  revision_parent_pr: EventIdString
}

interface PrRevisionRef extends EventRefBase {
  revision_parent_pr: EventIdString
}

type EventRef = EventRefBase | PrRevisionRef

export interface WithNaddr {
  naddr: Naddr
}

// export interface WithRelayInsights {
//   seen_on_relays: string[]
// }

enum IssueOrPrStatus {
  Open = 1630,
  Applied = 1631,
  Closed = 1632,
  Draft = 1633,
}

export function statusKindtoText(
  kind: IssueOrPrStatus,
  type: 'proposal' | 'issue'
): string {
  if (kind === IssueOrPrStatus.Open) return 'Open'
  if (type === 'proposal' && kind === IssueOrPrStatus.Applied) return 'Applied'
  if (type === 'issue' && kind === IssueOrPrStatus.Applied) return 'Resolved'
  if (kind === IssueOrPrStatus.Closed) return 'Closed'
  return 'Draft'
}

interface StatusRef extends EventRefBase {
  status: IssueOrPrStatus
}
interface IssueOrPrBase extends EventRefBase {
  title: string
  descritpion: string
  revision_parent_pr: EventIdString | undefined
}

export interface IssueOrPrWithReferences extends IssueOrPrBase {
  status: IssueOrPrStatus
  status_refs: StatusRef[]
  thread: EventRef[]
}

export const eventToIssue = (
  event: Event
): IssueOrPrWithReferences | undefined => {
  const issue = eventToIssueOrPr(event)
  if (!issue || event.kind !== issue_kind) return undefined
  const title = extractIssueTitle(event)
  return {
    ...issue,
    title,
    descritpion: title.startsWith(`${title}\n`)
      ? event.content.slice(title.length).trim()
      : event.content.trim(),
  }
}

export const eventToPrRoot = (
  event: Event
): IssueOrPrWithReferences | undefined => {
  const pr = eventToIssueOrPr(event)
  if (!pr || event.kind !== patch_kind) return undefined
  if (
    !event.tags.some((t) => t[0] === 't' && t[1] === 'root') &&
    // gitstr doesn't include 'root' tag so we have to check for events without a parent patch
    !event.tags.some((t) => t[0] === 'e')
  )
    return undefined
  const title = (
    getTagValue(event.tags, 'name') ||
    getTagValue(event.tags, 'description') ||
    extractPatchMessage(event.content) ||
    ''
  ).split('\n')[0]
  const descritpion =
    getTagValue(event.tags, 'description') ||
    extractPatchMessage(event.content) ||
    ''
  let revision_parent_pr = undefined

  if (event.tags.some((t) => t[0] === 't' && t[1] === 'revision-root')) {
    let tag = event.tags.find((t) => t[0] === 'e' && t[2] === 'reply')
    if (!tag) tag = event.tags.find((t) => t[0] === 'e')
    if (tag) revision_parent_pr = tag[1]
  }
  return {
    ...pr,
    title,
    descritpion: descritpion.startsWith(`${title}\n`)
      ? event.content.slice(title.length).trim()
      : event.content.trim(),
    revision_parent_pr,
  }
}

export const eventToIssueOrPr = (event: Event) => {
  if (![issue_kind, patch_kind].includes(event.kind)) return undefined
  const a_refs = event.tags
    .filter((t) => t[0] === 'a' && t[1].startsWith(repo_kind.toFixed()))
    .map((t) => t[1] as ARef)
  if (a_refs.length === 0) return undefined

  return {
    uuid: event.id,
    event_id: undefined,
    parent_id: a_refs,
    revision_parent_pr: undefined,
    kind: event.kind,
    author: event.pubkey,
    created_at: event.created_at,
    status: IssueOrPrStatus.Open,
    status_refs: [],
    thread: [],
  }
}

interface PubkeyEventStamp {
  event_id: EventIdString
  created_at: Timestamp
}

export interface PubKeyMetadataInfo extends SeenOn {
  fields: ProfileContent
  stamp: PubkeyEventStamp | undefined
}

export interface PubKeyRelayInfo extends SeenOn {
  read: string[]
  write: string[]
  relay_hints_found: string[]
  stamp: PubkeyEventStamp | undefined
}
export interface PubKeyInfo {
  pubkey: PubKeyString
  npub: Npub
  metadata: PubKeyMetadataInfo
  relays: PubKeyRelayInfo
}

export const createPubKeyInfo = (pubkey: PubKeyString): PubKeyInfo => {
  return {
    pubkey: pubkey,
    npub: isHexKey(pubkey) ? npubEncode(pubkey) : 'npub1invalidkey',
    metadata: {
      fields: {},
      stamp: undefined,
      seen_on: new Map(),
    },
    relays: {
      read: [],
      write: [],
      relay_hints_found: [],
      stamp: undefined,
      seen_on: new Map(),
    },
  }
}

export const isPubKeyMetadataLoading = (
  info: PubKeyInfo | undefined
): boolean => {
  if (!info) return true
  const five_mins_ago = Date.now() - 1000 * 60 * 10
  if (Object.keys(info.metadata.fields).length === 0) {
    if (info.metadata.seen_on.size === 0) return true
    return [...info.metadata.seen_on].every(
      ([_, seen]) => seen.last_check * 1000 < five_mins_ago
    )
  }
  return false
}
