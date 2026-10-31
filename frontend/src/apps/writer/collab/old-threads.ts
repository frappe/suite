import { v4 } from 'uuid'

import { isPlainObject } from '@/apps/writer/collab/inventory'

// What Drive stores for a comment: its text's bytes and blank as the server reads them, the
// display name's length in code points and the last year a server time holds
const MAX_COMMENT_BYTES = 65_535
const NAME_LIMIT = 140
const LAST_YEAR = 9999
const BLANK = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/
const LONE_SURROGATE = /\p{Cs}/u
const LAST_TIME = Date.UTC(LAST_YEAR + 1, 0, 1)

const THREAD_KEYS = new Set(['uuid', 'comments'])
const ENTRY_KEYS = new Set(['userName', 'userImage', 'time', 'content'])

/** A comment of Drive's 2023 thread: its words, the name it showed and its time in ms */
export interface OldComment {
  content: string
  authorName: string
  time: number
}

interface Entry extends OldComment {
  image: string | null | undefined
}

function isStorable(text: unknown): text is string {
  return typeof text === 'string' && !BLANK.test(text) && !LONE_SURROGATE.test(text)
}

function isContent(content: unknown): content is string {
  return isStorable(content) && new TextEncoder().encode(content).length <= MAX_COMMENT_BYTES
}

function isName(name: unknown): name is string {
  return isStorable(name) && [...name].length <= NAME_LIMIT
}

function isTime(time: unknown): time is number {
  return typeof time === 'number' && time >= 0 && time < LAST_TIME
}

function isImage(image: unknown): image is string | null | undefined {
  return image === undefined || image === null || typeof image === 'string'
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function hasOnly(value: Record<string, unknown>, keys: Set<string>) {
  return Object.keys(value).every((key) => keys.has(key))
}

function entryOf(value: unknown): Entry | null {
  if (!isPlainObject(value) || !hasOnly(value, ENTRY_KEYS)) {
    return null
  }

  const { content, userName, time, userImage } = value
  if (!isContent(content) || !isName(userName) || !isTime(time) || !isImage(userImage)) {
    return null
  }

  return { content, authorName: userName, time, image: userImage }
}

// The old editor wrote its comment list as an array or as JSON text
function listOf(comments: unknown) {
  if (typeof comments === 'string') {
    return parsed(comments)
  }

  return comments
}

function threadOf(text: string) {
  const thread = parsed(text)
  if (!isPlainObject(thread) || !hasOnly(thread, THREAD_KEYS)) {
    return null
  }

  const { uuid } = thread
  const list = listOf(thread.comments)
  if (typeof uuid !== 'string' || !uuid || !Array.isArray(list) || !list.length) {
    return null
  }

  const entries = list.map(entryOf)
  if (!entries.every((entry): entry is Entry => entry !== null)) {
    return null
  }

  return { uuid, entries }
}

function isSameEntry(one: Entry, other: Entry) {
  return (
    one.content === other.content &&
    one.authorName === other.authorName &&
    one.time === other.time &&
    one.image === other.image
  )
}

function isStartOf(entries: Entry[], longest: Entry[]) {
  return entries.every((entry, index) => isSameEntry(entry, longest[index]))
}

// Each thread's lists by its id, and the id each mark's text names; null when one can't be read
function listsOf(texts: string[]) {
  const lists = new Map<string, Entry[][]>()
  const uuids = new Map<string, string>()
  for (const text of new Set(texts)) {
    const thread = threadOf(text)
    if (!thread) {
      return null
    }

    uuids.set(text, thread.uuid)
    const known = lists.get(thread.uuid) ?? []
    known.push(thread.entries)
    lists.set(thread.uuid, known)
  }

  return { lists, uuids }
}

// The list every other one starts, or null when two part ways
function longestOf(lists: Entry[][]) {
  const longest = lists.reduce((kept, list) => (list.length > kept.length ? list : kept))
  return lists.every((list) => isStartOf(list, longest)) ? longest : null
}

/**
 * The threads Drive's 2023 comment marks held as JSON, each under a fresh key, and the key for
 * each mark's text. A reply rewrote only the marked words it was typed on, so one thread's marks
 * may hold the list up to an earlier comment; the longest holds them all. Null when a mark can't
 * be read or two of one thread's lists part ways.
 */
export function readOldThreads(texts: string[]) {
  const found = listsOf(texts)
  if (!found) {
    return null
  }

  const keys = new Map<string, string>()
  const threads: { key: string; comments: OldComment[] }[] = []
  for (const [uuid, lists] of found.lists) {
    const longest = longestOf(lists)
    if (!longest) {
      return null
    }

    const key = v4()
    keys.set(uuid, key)
    threads.push({
      key,
      comments: longest.map(({ content, authorName, time }) => ({ content, authorName, time })),
    })
  }

  const keyOf = new Map([...found.uuids].map(([text, uuid]) => [text, keys.get(uuid)!]))
  const entries = [...found.lists.values()].flat().flat()
  const hasImages = entries.some((entry) => entry.image)
  return { keyOf, threads, hasImages }
}
