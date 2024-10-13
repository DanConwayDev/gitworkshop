import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
  selectedRepoCollectionToMaintainers,
  type ARef,
  type SelectedRepoCollection,
} from './dbs/types'
import { repo_kind } from './kinds'
import type { AddressPointer } from 'nostr-tools/nip19'
import {
  addressPointerToARef,
  aRefToAddressPointer,
} from './components/repo/utils'

// get value of first occurance of tag
export function getTagValue(
  tags: string[][],
  name: string
): string | undefined {
  return tags.find((t) => t[0] === name)?.[1]
}

// get value of each occurance of tag
export function getValueOfEachTagOccurence(
  tags: string[][],
  name: string
): string[] {
  return tags.filter((t) => t[0] === name).map((t) => t[1])
}

// get values of first occurance of tag
export function getTagMultiValue(
  tags: string[][],
  name: string
): string[] | undefined {
  const foundTag = tags.find((t) => t[0] === name)
  return foundTag ? foundTag.slice(1) : undefined
}

/// mutates the event
export function tagRepoAnns(
  event: NDKEvent,
  repo_collection: SelectedRepoCollection,
  as_root: boolean = false,
  and_maintainers: boolean = false
) {
  if (!repo_collection) return
  const relay_hint = !repo_collection.relays
    ? ''
    : repo_collection.relays[0] || ''

  selectedRepoCollectionToMaintainers(repo_collection).forEach((m, i) => {
    if (
      and_maintainers &&
      !event.tags.some((t) => t[0] === 'p' && t[1].includes(m))
    ) {
      event.tags.push(['p', m])
    }
    if (
      !event.tags.some(
        (t) =>
          t[0] === 'a' && t[1].includes(`${m}:${repo_collection.identifier}`)
      )
    )
      event.tags.push([
        'a',
        `${repo_kind}:${m}:${repo_collection.identifier}`,
        relay_hint,
        i === 0 && as_root ? 'root' : 'mention',
      ])
  })
}

function isAddressPointer(a: ARef | AddressPointer): a is AddressPointer {
  return typeof a !== 'string'
}

export function aToAddressPointerAndARef(a: ARef | AddressPointer):
  | {
      a_ref: ARef
      address_pointer: AddressPointer
    }
  | undefined {
  if (isAddressPointer(a)) {
    return {
      a_ref: addressPointerToARef(a),
      address_pointer: a,
    }
  } else {
    const address_pointer = aRefToAddressPointer(a)
    if (address_pointer) {
      return {
        address_pointer: address_pointer,
        a_ref: a,
      }
    }
  }
  return undefined
}
