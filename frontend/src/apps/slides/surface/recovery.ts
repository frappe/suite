/**
 * Slides' local recovery copies: the presentation's slides kept on this device,
 * per person, when unsaved work cannot reach the server. They are never replayed
 * automatically. The person takes one out as a JSON file, which removes nothing
 * since a browser save can't be confirmed, or dismisses it. A copy kept for lost
 * edit access or by the unload guard is also removed once the presentation saves
 * again with edit access, because it is then stale. A sticky copy, kept when the
 * server refused or a draft was discarded, is not.
 */
import { getCookieSessionUser } from '@/platform/session'

export interface RecoveryCopy {
  savedAt: string
  /** The editor's slides, as it holds them. */
  slides: unknown[]
  sticky: boolean
  downloaded?: boolean
}

function key(node: string) {
  const user = getCookieSessionUser() ?? 'Guest'
  return `suite:slides-recovery:${user}:${node}`
}

function isCopy(copy: Partial<RecoveryCopy> | null): copy is RecoveryCopy {
  return Array.isArray(copy?.slides) && typeof copy.savedAt === 'string'
}

export function readRecovery(node: string): RecoveryCopy[] {
  try {
    const copies = JSON.parse(localStorage.getItem(key(node)) ?? '[]') as RecoveryCopy[]
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

/** A save landed: only a sticky copy outlives it. */
export function clearStaleRecovery(node: string): void {
  const copies = readRecovery(node)
  const sticky = copies.filter((copy) => copy.sticky)
  if (sticky.length < copies.length) {
    writeCopies(node, sticky)
  }
}

export function removeNewestRecovery(node: string): void {
  writeCopies(node, readRecovery(node).slice(0, -1))
}

export function forgetRecovery(node: string, slides: readonly unknown[]): void {
  writeCopies(
    node,
    readRecovery(node).filter((copy) => !holds(copy, slides)),
  )
}

/** The copy as a JSON file, named after the presentation title. */
export function recoveryFile(copy: RecoveryCopy, title: string): File {
  const name = title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Presentation'
  const body = JSON.stringify({ title, recoveredAt: copy.savedAt, slides: copy.slides }, null, 2)
  return new File([body], `${name} (recovered).json`, { type: 'application/json' })
}

function saveThroughBrowser(file: File) {
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
