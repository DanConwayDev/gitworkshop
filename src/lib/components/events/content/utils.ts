import type { NDKTag } from '@nostr-dev-kit/ndk'
import { last } from 'ramda'

export const TOPIC = 'topic'
export const LINK = 'link'
export const LINKCOLLECTION = 'link[]'
export const HTML = 'html'
export const INVOICE = 'invoice'
export const NOSTR_NOTE = 'nostr:note'
export const NOSTR_NEVENT = 'nostr:nevent'
export const NOSTR_NPUB = 'nostr:npub'
export const NOSTR_NPROFILE = 'nostr:nprofile'
export const NOSTR_NADDR = 'nostr:naddr'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const first = (list: any) => (list ? list[0] : undefined)

export const fromNostrURI = (s: string) => s.replace(/^[\w+]+:\/?\/?/, '')

export const urlIsMedia = (url: string) =>
  !url.match(/\.(apk|docx|xlsx|csv|dmg)/) &&
  last(url.split('://'))?.includes('/')

export type ContentArgs = {
  content: string
  tags?: Array<NDKTag>
}

export type ParsedPart = ParsedNewLine | ParsedText

export const NEWLINE = 'newline'

export type ParsedNewLine = {
  type: 'newline'
  value: string
}

export const isParsedNewLine = (part: ParsedPart): part is ParsedNewLine => {
  return part.type == 'newline'
}

export const TEXT = 'text'

export type ParsedText = {
  type: 'text'
  value: string
}

export const isParsedText = (part: ParsedPart): part is ParsedText => {
  return part.type == 'text'
}

export const parseContent = ({ content }: ContentArgs): ParsedPart[] => {
  const result: ParsedPart[] = []
  let text = content.trim()
  let buffer = ''

  const parseNewline = () => {
    const newline = first(text.match(/^\n+/))

    if (newline) {
      return [NEWLINE, newline, newline]
    }
  }

  while (text) {
    // The order that this runs matters
    const part = parseNewline()

    if (part) {
      if (buffer) {
        result.push({ type: 'text', value: buffer })
        buffer = ''
      }

      const [type, raw, value] = part

      result.push({ type, value })
      text = text.slice(raw.length)
    } else {
      // Instead of going character by character and re-running all the above regular expressions
      // a million times, try to match the next word and add it to the buffer
      const match = first(text.match(/^[\w\d]+ ?/i)) || text[0]

      buffer += match
      text = text.slice(match.length)
    }
  }

  if (buffer) {
    result.push({ type: TEXT, value: buffer })
  }

  return result
}

/** this doesn't work for all patch formats and options */
export const extractPatchMessage = (s: string): string | undefined => {
  try {
    const t = s.split('\nSubject: [')[1].split('] ')[1]
    if (t.split('\n\n---\n ').length > 1) return t.split('\n\n---\n ')[0]
    return t.split('\n\ndiff --git ')[0].split('\n\n ').slice(0, -1).join('')
  } catch {
    return undefined
  }
}

/** this doesn't work for all patch formats and options */
export const extractPatchTitle = (s: string): string | undefined => {
  const msg = extractPatchMessage(s)
  if (!msg) return undefined
  return s.split('\n')[0]
}

export const extractIssueTitle = (s: string): string => {
  return s.split('\n')[0] || ''
}

export const extractIssueDescription = (s: string): string => {
  const split = s.split('\n')
  if (split.length === 0) return ''
  return s.substring(split[0].length) || ''
}
