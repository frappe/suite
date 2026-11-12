/**
 * Slides' local recovery copies: the presentation's slides kept on this device,
 * per person, when unsaved work cannot reach the server. They are never replayed
 * automatically. The person takes one out as a JSON file, which removes nothing
 * since a browser save can't be confirmed, or dismisses it. A newer copy replaces an
 * older one, except a sticky copy, kept once edit access had gone: it may hold edits
 * that are nowhere else.
 */
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

function key(node: string) {
  return `${keyPrefix()}${node}`
}

/** The presentations this person keeps copies of on this device; none where the browser blocks site data. */
export function recoveryNodes(): string[] {
  try {
    const prefix = keyPrefix()
    return Object.keys(localStorage).flatMap((stored) =>
      stored.startsWith(prefix) ? [stored.slice(prefix.length)] : [],
    )
  } catch {
    return []
  }
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

export function readRecovery(node: string): RecoveryCopy[] {
  try {
    const copies: unknown = JSON.parse(localStorage.getItem(key(node)) ?? '[]')
    if (!Array.isArray(copies)) {
      return []
    }

    return copies.filter(isCopy)
  } catch {
    return []
  }
}

function writeCopies(node: string, copies: RecoveryCopy[]) {
  if (copies.length) {
    localStorage.setItem(key(node), JSON.stringify(copies))
  } else {
    localStorage.removeItem(key(node))
  }
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
  const copies = readRecovery(node)
  const copy = { savedAt: now.toISOString(), slides: [...slides], sticky }
  const same = copies.find((kept) => holds(kept, slides))
  if (same) {
    const moved = { ...same, savedAt: copy.savedAt, sticky: sticky || same.sticky }
    writeCopies(node, [...copies.filter((kept) => kept !== same), moved])
    return
  }

  writeCopies(node, [...copies.filter((kept) => sticky || kept.sticky), copy])
}

/**
 * Run once the open first draws the presentation, before it keeps a copy of its own: a copy that
 * differs from what is shown may hold edits that are nowhere else, so no later copy replaces it.
 * On a full store the copy just stays as it was.
 */
export function keepOutlivedRecovery(node: string, shown: readonly unknown[]): void {
  const copies = readRecovery(node)
  const kept = copies.map((copy) => ({ ...copy, sticky: copy.sticky || !holds(copy, shown) }))
  try {
    writeCopies(node, kept)
  } catch {
    // a later copy may replace it, as before
  }
}

/** Discards the copy as shown: two copies can share a date, so its slides tell them apart. */
export function discardRecovery(node: string, savedAt: string, slides: readonly unknown[]): void {
  writeCopies(
    node,
    readRecovery(node).filter((copy) => copy.savedAt !== savedAt || !holds(copy, slides)),
  )
}

export function removeNewestRecovery(node: string): void {
  writeCopies(node, readRecovery(node).slice(0, -1))
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
  const copies = readRecovery(node)
  const copy = copies.findLast((kept) => !kept.downloaded) ?? copies.at(-1)
  if (!copy) {
    return false
  }

  saveThroughBrowser(recoveryFile(copy, title))
  copy.downloaded = true
  try {
    writeCopies(node, copies)
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
