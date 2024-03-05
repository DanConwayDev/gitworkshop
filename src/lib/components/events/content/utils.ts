import type { NDKTag } from '@nostr-dev-kit/ndk'
import { last } from 'ramda'

export const TOPIC = 'topic'
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

export const urlIsMedia = (url: string): boolean =>
  (!url.match(/\.(apk|docx|xlsx|csv|dmg)/) &&
    last(url.split('://'))?.includes('/')) ||
  false

export const isImage = (url: string) =>
  url.match(/^.*\.(jpg|jpeg|png|webp|gif|avif|svg)/gi)
export const isVideo = (url: string) =>
  url.match(/^.*\.(mov|mkv|mp4|avi|m4v|webm)/gi)
export const isAudio = (url: string) => url.match(/^.*\.(ogg|mp3|wav)/gi)

export const NEWLINE = 'newline'
type PartTypeNewLine = 'newline'
export type ParsedNewLine = {
  type: PartTypeNewLine
  value: string
}

export const LINK = 'link'
type PartTypeLink = 'link'
export type ParsedLink = {
  type: PartTypeLink
  url: string
  is_media: boolean
  imeta: Imeta | undefined
}
type Imeta = {
  url: string
  m: string | undefined
  alt: string | undefined
  size: string | undefined
  dim: string | undefined
  x: string | undefined
  fallback: string[]
  blurhash: string | undefined
}

export const TEXT = 'text'
type PartTypeText = 'text'
export type ParsedText = {
  type: PartTypeText
  value: string
}

export type ParsedPart = ParsedNewLine | ParsedText | ParsedLink

export const isParsedNewLine = (part: ParsedPart): part is ParsedNewLine =>
  part.type == NEWLINE

export const isParsedLink = (part: ParsedPart): part is ParsedLink =>
  part.type == LINK

export const isParsedText = (part: ParsedPart): part is ParsedText =>
  part.type == TEXT

export const parseContent = (content: string, tags: NDKTag[]): ParsedPart[] => {
  const result: ParsedPart[] = []
  let text = content.trim()
  let buffer = ''

  const getIMeta = (url: string): undefined | Imeta => {
    const imeta_tag_for_url = tags.find(
      (tag) => tag[0] === 'imeta' && tag.some((e) => e.includes(url))
    )
    if (!imeta_tag_for_url) return undefined
    const pairs = imeta_tag_for_url.map((s) => [
      s.split(' ')[0],
      s.substring(s.indexOf(' ') + 1),
    ])
    return {
      url,
      m: pairs.find((p) => p[0] === 'm')?.[1],
      alt: pairs.find((p) => p[0] === 'alt')?.[1],
      x: pairs.find((p) => p[0] === 'x')?.[1],
      size: pairs.find((p) => p[0] === 'size')?.[1],
      dim: pairs.find((p) => p[0] === 'dim')?.[1],
      blurhash: pairs.find((p) => p[0] === 'blurhash')?.[1],
      fallback: pairs.filter((p) => p[0] === 'fallback')?.map((p) => p[1]),
    }
  }

  const parseNewline = (): undefined | [string, ParsedNewLine] => {
    const newline: string = first(text.match(/^\n+/))

    if (newline) {
      return [newline, { type: NEWLINE, value: newline }]
    }
  }

  const parseUrl = (): undefined | [string, ParsedLink] => {
    const raw: string = first(
      text.match(
        /^([a-z\+:]{2,30}:\/\/)?[^<>\(\)\s]+\.[a-z]{2,6}[^\s]*[^<>"'\.!?,:\s\)\(]/gi
      )
    )

    // Skip url if it's just the end of a filepath
    if (!raw) {
      return
    }

    const prev = last(result)

    if (prev?.type === TEXT && prev.value.endsWith('/')) {
      return
    }

    let url = raw

    // Skip ellipses and very short non-urls
    if (url.match(/\.\./)) {
      return
    }

    if (!url.match('://')) {
      url = 'https://' + url
    }

    return [
      raw,
      { type: LINK, url, is_media: urlIsMedia(url), imeta: getIMeta(url) },
    ]
  }

  while (text) {
    // The order that this runs matters
    const part = parseNewline() || parseUrl()

    if (part) {
      if (buffer) {
        result.push({ type: TEXT, value: buffer })
        buffer = ''
      }

      const [raw, parsed] = part

      result.push(parsed)
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

export const isCoverLetter = (s: string): boolean => {
  return s.indexOf('PATCH 0/') > 0
}

/** this doesn't work for all patch formats and options */
export const extractPatchMessage = (s: string): string | undefined => {
  try {
    if (isCoverLetter(s)) {
      return s.substring(s.indexOf('] ') + 2)
    }
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

/** patch message without first line */
export const extractPatchDescription = (s: string): string | undefined => {
  const msg = extractPatchMessage(s)
  if (!msg) return ''
  const i = msg.indexOf('\n')
  if (i === -1) return ''
  return msg.substring(i).trim()
}

export const extractIssueTitle = (s: string): string => {
  return s.split('\n')[0] || ''
}

export const extractIssueDescription = (s: string): string => {
  const split = s.split('\n')
  if (split.length === 0) return ''
  return s.substring(split[0].length) || ''
}
