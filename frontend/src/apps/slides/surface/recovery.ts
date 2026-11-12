/**
 * Slides' local recovery copies: the presentation's slides kept on this device,
 * per person, when unsaved work cannot reach the server. They are never replayed
 * automatically. The person takes one out as a JSON file, which removes nothing
 * since a browser save can't be confirmed, or dismisses it. A newer copy replaces an
 * older one, except a sticky copy, kept once edit access had gone: it may hold edits
 * that are nowhere else.
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

// The older single list of a presentation's copies. Each copy now has its own key below it, so
// a tab writes or removes only the copy it means and never rewrites another tab's
function listKey(node: string) {
  return `${keyPrefix()}${node}`
}

function recordKey(node: string, id: string) {
  return `${listKey(node)}:${id}`
}

// This tab's own unsent copy is rewritten under this id; every sticky copy gets an id of its own
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

// An older list's copy keeps one id however many tabs split it, so none is kept twice
function listedId(copy: RecoveryCopy) {
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
  return `listed-${(second >>> 0).toString(36)}${(first >>> 0).toString(36)}`
}

// Moves an older list's copies to keys of their own, then removes the list if no tab changed it;
// a full store leaves the list, read as it is
function splitList(node: string) {
  const list = localStorage.getItem(listKey(node))
  const copies = parsed(list)
  if (list === null || !Array.isArray(copies)) {
    return
  }

  try {
    for (const copy of copies.filter(isCopy)) {
      const key = recordKey(node, listedId(copy))
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(copy))
      }
    }
  } catch {
    return
  }

  if (localStorage.getItem(listKey(node)) === list) {
    localStorage.removeItem(listKey(node))
  }
}

export interface RecoveryRecord {
  id: string
  copy: RecoveryCopy
  // The order a tab kept its copies in, where two share a date
  seq: number
}

/** Each copy kept of the presentation with its id, oldest first. */
export function recoveryRecords(node: string): RecoveryRecord[] {
  try {
    splitList(node)
    const prefix = `${listKey(node)}:`
    const records = Object.keys(localStorage).flatMap((stored) => {
      const value = parsed(stored.startsWith(prefix) ? localStorage.getItem(stored) : null)
      if (!isStored(value)) {
        return []
      }

      const { seq = 0, ...copy } = value
      return [{ id: stored.slice(prefix.length), copy, seq }]
    })
    // a list a full store kept from splitting, less the copies already on their own
    const listed = parsed(localStorage.getItem(listKey(node)))
    const unsplit = (Array.isArray(listed) ? listed.filter(isCopy) : [])
      .map((copy) => ({ id: listedId(copy), copy, seq: 0 }))
      .filter(({ id }) => !records.some((record) => record.id === id))
    return [...records, ...unsplit].sort(
      (first, second) =>
        first.copy.savedAt.localeCompare(second.copy.savedAt) || first.seq - second.seq,
    )
  } catch {
    return []
  }
}

export function readRecovery(node: string): RecoveryCopy[] {
  return recoveryRecords(node).map(({ copy }) => copy)
}

// A mark keeps the copy's place among those of its date; a keep puts it last
function writeRecord(node: string, id: string, copy: RecoveryCopy, seq = ++writes) {
  localStorage.setItem(recordKey(node, id), JSON.stringify({ ...copy, seq }))
}

function holds(copy: RecoveryCopy, slides: readonly unknown[]) {
  return JSON.stringify(copy.slides) === JSON.stringify(slides)
}

// the copies a full store kept from being marked sticky, which stay sticky for the page
const unmarkedSticky = new Set<string>()

function isSticky(node: string, { id, copy }: RecoveryRecord) {
  return !!copy.sticky || unmarkedSticky.has(recordKey(node, id))
}

/** Throws when the browser's store is full. */
export function keepRecovery(
  node: string,
  slides: readonly unknown[],
  { sticky = false, now = new Date() } = {},
): void {
  const savedAt = now.toISOString()
  const same = recoveryRecords(node).find(({ copy }) => holds(copy, slides))
  if (same) {
    const moved = { ...same.copy, savedAt, sticky: sticky || isSticky(node, same) }
    // a copy turning sticky leaves this page's id, which the next unsent copy takes
    if (moved.sticky && same.id === PAGE_LOAD) {
      writeRecord(node, randomId(), moved)
      localStorage.removeItem(recordKey(node, PAGE_LOAD))
      return
    }

    writeRecord(node, same.id, moved)
    return
  }

  // a sticky copy is added; an unsent one takes the place of this tab's last
  const id = sticky ? randomId() : PAGE_LOAD
  writeRecord(node, id, { savedAt, slides: [...slides], sticky })
}

/**
 * Run once the open first draws the presentation, before it keeps a copy of its own. Another
 * page load's unsent copy that differs from what is shown may hold edits that are nowhere else,
 * so it turns sticky; one that holds what is shown has nothing to recover, and goes.
 * On a full store the copy stays as it was, and sticky for the page.
 */
export function keepOutlivedRecovery(node: string, shown: readonly unknown[]): void {
  for (const record of recoveryRecords(node)) {
    if (record.id === PAGE_LOAD || isSticky(node, record)) {
      continue
    }

    const key = recordKey(node, record.id)
    if (holds(record.copy, shown)) {
      removeUnchanged(key, record)
      continue
    }

    try {
      writeRecord(node, record.id, { ...record.copy, sticky: true }, record.seq)
    } catch {
      unmarkedSticky.add(key)
    }
  }
}

// Read again just before the remove, so a copy its tab wrote since stays. The two calls run
// back to back in one task: only that copy's own tab writes its key, and it keeps an unsent copy
// only while it can still send to the room, so a write landing between them holds edits the
// room gets too
function removeUnchanged(key: string, { copy, seq }: RecoveryRecord) {
  const stored = parsed(localStorage.getItem(key))
  if (!isStored(stored)) {
    return
  }

  const { seq: storedSeq = 0, ...storedCopy } = stored
  if (storedSeq === seq && JSON.stringify(storedCopy) === JSON.stringify(copy)) {
    localStorage.removeItem(key)
  }
}

/** Discards the copy with this id while it holds what was shown; one its tab rewrote since stays. */
export function discardRecovery(
  node: string,
  id: string,
  shown: Pick<RecoveryCopy, 'savedAt' | 'slides'>,
): void {
  splitList(node)
  const key = recordKey(node, id)
  const stored = parsed(localStorage.getItem(key))
  if (
    isCopy(stored) &&
    Date.parse(stored.savedAt) === Date.parse(shown.savedAt) &&
    holds(stored, shown.slides)
  ) {
    localStorage.removeItem(key)
  }
}

export function newestRecovery(node: string): RecoveryRecord | undefined {
  return recoveryRecords(node).at(-1)
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
 * Removes nothing. False when none is kept.
 */
export function downloadRecovery(node: string, title: string): boolean {
  const records = recoveryRecords(node)
  const record = records.findLast(({ copy }) => !copy.downloaded) ?? records.at(-1)
  if (!record) {
    return false
  }

  saveThroughBrowser(recoveryFile(record.copy, title))
  // marks the copy only while it is still kept, so a discard from another tab stays
  if (localStorage.getItem(recordKey(node, record.id)) === null) {
    return true
  }

  try {
    writeRecord(node, record.id, { ...record.copy, downloaded: true }, record.seq)
  } catch {
    // the file has already gone out
  }

  return true
}

/** Save the slides on screen through the browser, whatever the copies hold. */
export function downloadSlides(slides: readonly unknown[], title: string, now = new Date()): void {
  const copy = { savedAt: now.toISOString(), slides: [...slides], sticky: false }
  saveThroughBrowser(recoveryFile(copy, title))
}
