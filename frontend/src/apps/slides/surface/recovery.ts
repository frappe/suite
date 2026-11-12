/**
 * Slides' local recovery copies: the presentation's slides kept on this device,
 * per person, when unsaved work cannot reach the server. They are never replayed
 * automatically, and stay until the person discards one. Taking one out as a JSON
 * file removes nothing, since a browser save can't be confirmed. Each page load keeps
 * its unsent copy under a key of its own and writes no other tab's; a sticky copy,
 * kept once edit access had gone, gets a key of its own and is written once.
 */
import { randomId } from '@/platform/random-id'
import { getCookieSessionUser } from '@/platform/session'

export interface RecoveryCopy {
  savedAt: string
  /** The editor's slides, as it holds them. */
  slides: unknown[]
  /** Older device copies predate the sticky marker and behave as non-sticky. */
  sticky?: boolean | undefined
  downloaded?: boolean
}

function keyPrefix() {
  const user = getCookieSessionUser() ?? 'Guest'
  return `suite:slides-recovery:${user}:`
}

// The older single list of a presentation's copies, only ever read: no tab rewrites or removes it
function listKey(node: string) {
  return `${keyPrefix()}${node}`
}

function recordKey(node: string, id: string) {
  return `${listKey(node)}:${id}`
}

// A write-once mark that a copy was downloaded, or dismissed where no tab may remove it. It holds
// the copy's date and slides, so a newer copy its tab writes under the same key shows as new
function markKey(node: string, kind: 'downloaded' | 'dismissed', id: string, copy: RecoveryCopy) {
  return `${listKey(node)}:${kind}:${id}:${hashOf(copy)}`
}

// This page load's unsent copy, the one key this page ever rewrites
const PAGE_LOAD = randomId()
// The order this tab writes its copies in
let writes = 0

/** The presentations this person keeps copies of on this device; none where the browser blocks site data. */
export function recoveryNodes(): string[] {
  try {
    const prefix = keyPrefix()
    const nodes = Object.keys(localStorage).flatMap((stored) =>
      stored.startsWith(prefix) ? [stored.slice(prefix.length).split(':')[0]!] : [],
    )
    return [...new Set(nodes)]
  } catch {
    return []
  }
}

// A copy as its key holds it: the order its tab kept it in beside it
interface StoredCopy extends RecoveryCopy {
  seq?: number
}

function isStored(copy: unknown): copy is StoredCopy {
  return isCopy(copy) && (!('seq' in copy) || typeof copy.seq === 'number')
}

function isCopy(copy: unknown): copy is RecoveryCopy {
  return (
    !!copy &&
    typeof copy === 'object' &&
    'slides' in copy &&
    Array.isArray(copy.slides) &&
    'savedAt' in copy &&
    typeof copy.savedAt === 'string' &&
    (!('sticky' in copy) || copy.sticky === undefined || typeof copy.sticky === 'boolean') &&
    (!('downloaded' in copy) ||
      copy.downloaded === undefined ||
      typeof copy.downloaded === 'boolean')
  )
}

function parsed(value: string | null) {
  try {
    const read: unknown = JSON.parse(value ?? 'null')
    return read
  } catch {
    return null
  }
}

// The copy's date and slides, hashed
function hashOf(copy: RecoveryCopy) {
  const text = JSON.stringify([copy.savedAt, copy.slides])
  let [first, second] = [0xdeadbeef, 0x41c6ce57]
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)
  return `${(second >>> 0).toString(36)}${(first >>> 0).toString(36)}`
}

interface StoredRecord {
  id: string
  copy: RecoveryCopy
  // The order a tab kept its copies in, where two share a date
  seq: number
  // In the older list, which has no key of its own per copy
  isListed: boolean
}

// Each copy the device holds of the presentation, less those dismissed, with its download marked
function storedRecords(node: string): StoredRecord[] {
  const prefix = `${listKey(node)}:`
  const records = Object.keys(localStorage).flatMap((stored) => {
    const id = stored.slice(prefix.length)
    const value =
      stored.startsWith(prefix) && !id.includes(':') ? localStorage.getItem(stored) : null
    const read = parsed(value)
    if (!isStored(read)) {
      return []
    }

    const { seq = 0, ...copy } = read
    return [{ id, copy, seq, isListed: false }]
  })
  const list = parsed(localStorage.getItem(listKey(node)))
  const listed = (Array.isArray(list) ? list.filter(isCopy) : []).map((copy) => ({
    id: `listed-${hashOf(copy)}`,
    copy,
    seq: 0,
    isListed: true,
  }))
  return [...records, ...listed].flatMap((record) => {
    if (localStorage.getItem(markKey(node, 'dismissed', record.id, record.copy)) !== null) {
      return []
    }

    const isMarked = localStorage.getItem(markKey(node, 'downloaded', record.id, record.copy))
    return [isMarked === null ? record : { ...record, copy: { ...record.copy, downloaded: true } }]
  })
}

/** A copy as the person sees it: the keys holding the same slides shown as one. */
export interface RecoveryEntry {
  id: string
  copy: RecoveryCopy
}

/** Each copy kept of the presentation, oldest first. */
export function recoveryEntries(node: string): RecoveryEntry[] {
  try {
    const records = storedRecords(node).sort(
      (first, second) =>
        first.copy.savedAt.localeCompare(second.copy.savedAt) || first.seq - second.seq,
    )
    // by slides, so the newest of a kind comes last in the order it was kept
    const entries = new Map<string, { ids: string[]; copy: RecoveryCopy }>()
    for (const record of records) {
      const slides = JSON.stringify(record.copy.slides)
      const same = entries.get(slides)
      entries.delete(slides)
      // the newest copy's date, sticky or downloaded if any of them is
      const sticky = same?.copy.sticky || record.copy.sticky
      const downloaded = same?.copy.downloaded || record.copy.downloaded ? { downloaded: true } : {}
      entries.set(slides, {
        ids: [...(same?.ids ?? []), record.id],
        copy: { ...record.copy, sticky, ...downloaded },
      })
    }

    return [...entries.values()].map(({ ids, copy }) => ({ id: ids.join(','), copy }))
  } catch {
    return []
  }
}

export function readRecovery(node: string): RecoveryCopy[] {
  return recoveryEntries(node).map(({ copy }) => copy)
}

function holds(copy: RecoveryCopy, slides: readonly unknown[]) {
  return JSON.stringify(copy.slides) === JSON.stringify(slides)
}

/** Throws when the browser's store is full. */
export function keepRecovery(
  node: string,
  slides: readonly unknown[],
  { sticky = false, now = new Date() } = {},
): void {
  const own = recordKey(node, PAGE_LOAD)
  const records = storedRecords(node)
  const ownCopy = records.find(({ id }) => id === PAGE_LOAD)?.copy
  const isOwnSame = !!ownCopy && holds(ownCopy, slides)
  // a sticky copy holds these slides past any later copy already
  if (records.some(({ copy }) => copy.sticky && holds(copy, slides))) {
    if (!sticky || isOwnSame) {
      localStorage.removeItem(own)
    }

    return
  }

  // this page's download of the same slides still counts for its sticky copy
  const downloaded = sticky && isOwnSame && ownCopy.downloaded ? { downloaded: true } : {}
  const copy = { savedAt: now.toISOString(), slides: [...slides], sticky, ...downloaded }
  localStorage.setItem(recordKey(node, sticky ? randomId() : PAGE_LOAD), stored(copy))
  // this page's unsent copy of the same slides is kept sticky now
  if (sticky && isOwnSame) {
    localStorage.removeItem(own)
  }
}

function stored(copy: RecoveryCopy) {
  return JSON.stringify({ ...copy, seq: ++writes })
}

/**
 * Discards the copy as shown, under each key that still holds its slides. This page's own copy
 * and a sticky one, written once, are removed. Another page load's unsent copy, or one in the
 * older list, is marked dismissed instead, as its tab may still write a newer one there.
 * Throws when the browser's store is too full for the mark.
 */
export function discardRecovery(
  node: string,
  id: string,
  shown: Pick<RecoveryCopy, 'slides'>,
): void {
  const ids = new Set(id.split(','))
  for (const record of storedRecords(node)) {
    if (!ids.has(record.id) || !holds(record.copy, shown.slides)) {
      continue
    }

    if (record.isListed || (record.id !== PAGE_LOAD && !record.copy.sticky)) {
      localStorage.setItem(markKey(node, 'dismissed', record.id, record.copy), '1')
    } else {
      localStorage.removeItem(recordKey(node, record.id))
    }
  }
}

export function newestRecovery(node: string): RecoveryEntry | undefined {
  return recoveryEntries(node).at(-1)
}

/** The title as a file name: the characters no file system takes dropped. */
export function fileTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Presentation'
}

/** The copy as a JSON file, named after the presentation title. */
export function recoveryFile(copy: RecoveryCopy, title: string): File {
  const name = fileTitle(title)
  const body = JSON.stringify({ title, recoveredAt: copy.savedAt, slides: copy.slides }, null, 2)
  return new File([body], `${name} (recovered).json`, { type: 'application/json' })
}

export function saveThroughBrowser(file: File) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Save the newest copy not yet downloaded through the browser, or the newest once all are.
 * Removes nothing. `unmarked` when the file went out but the store was too full to note it.
 */
export function downloadRecovery(node: string, title: string): 'none' | 'downloaded' | 'unmarked' {
  const entries = recoveryEntries(node)
  const entry = entries.findLast(({ copy }) => !copy.downloaded) ?? entries.at(-1)
  if (!entry) {
    return 'none'
  }

  saveThroughBrowser(recoveryFile(entry.copy, title))
  const ids = new Set(entry.id.split(','))
  try {
    for (const record of storedRecords(node)) {
      if (ids.has(record.id) && holds(record.copy, entry.copy.slides)) {
        localStorage.setItem(markKey(node, 'downloaded', record.id, record.copy), '1')
      }
    }
  } catch {
    return 'unmarked'
  }

  return 'downloaded'
}

/** Save the slides on screen through the browser, whatever the copies hold. */
export function downloadSlides(slides: readonly unknown[], title: string, now = new Date()): void {
  const copy = { savedAt: now.toISOString(), slides: [...slides], sticky: false }
  saveThroughBrowser(recoveryFile(copy, title))
}
