import { onScopeDispose, shallowRef } from 'vue'

/**
 * Shortcuts typed as plain letters, Gmail style: `S` alone, or `G` then `H`.
 * frappe-ui's registry matches one combo per press, so the sequences live here.
 * A letter counts only with no modifier held, outside text fields, menus and
 * dialogs, so it never steals a typed character. The first key of a sequence
 * waits `PENDING_MS` for the second; any other key or the timeout drops it.
 */

// prettier-ignore
export type Letter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'

export interface KeySequenceShortcut {
  /** One letter, or two pressed one after the other. */
  keys: readonly [Letter] | readonly [Letter, Letter]
  /** The row's label in the shortcuts dialog. */
  description: string
  /** The heading the row is listed under in the shortcuts dialog. */
  group: string
  /** Fires and is listed only while this answers `true`. */
  enabled?: () => boolean
  handler: (event: KeyboardEvent) => void
}

const PENDING_MS = 1500

const TYPING_TARGETS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
].join(', ')

const registered = shallowRef<readonly KeySequenceShortcut[]>([])
let pending: { key: Letter; timer: ReturnType<typeof setTimeout> } | undefined

/** Registers key sequences until the calling scope is disposed. Call it in a component's setup. */
export function useKeySequences(shortcuts: readonly KeySequenceShortcut[]): void {
  if (!registered.value.length) document.addEventListener('keydown', onKeydown)
  registered.value = [...registered.value, ...shortcuts]
  onScopeDispose(() => {
    registered.value = registered.value.filter((shortcut) => !shortcuts.includes(shortcut))
    if (registered.value.length) return
    document.removeEventListener('keydown', onKeydown)
    cancelPending()
  })
}

/** The sequences on offer now, in registration order, for the shortcuts dialog. */
export function liveKeySequences(): readonly KeySequenceShortcut[] {
  return registered.value.filter((shortcut) => shortcut.enabled?.() ?? true)
}

function onKeydown(event: KeyboardEvent): void {
  const first = pending?.key
  cancelPending()
  const key = plainLetter(event)
  if (!key) return
  const live = liveKeySequences()
  // The key after a first key finishes that sequence or nothing; it starts no other.
  const match = first
    ? live.find(({ keys }) => keys[0] === first && keys[1] === key)
    : live.findLast(({ keys }) => keys.length === 1 && keys[0] === key)
  if (match) {
    event.preventDefault()
    match.handler(event)
  } else if (!first && live.some(({ keys }) => keys.length === 2 && keys[0] === key)) {
    event.preventDefault()
    pending = { key, timer: setTimeout(cancelPending, PENDING_MS) }
  }
}

function cancelPending(): void {
  if (pending) clearTimeout(pending.timer)
  pending = undefined
}

/** The letter typed with no modifier, where the press is not meant for a field, menu or dialog. */
function plainLetter(event: KeyboardEvent): Letter | undefined {
  if (event.defaultPrevented || event.repeat || event.isComposing) return undefined
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return undefined
  if (isTypingTarget(event.target)) return undefined
  const key = event.key.toUpperCase()
  return isLetter(key) ? key : undefined
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_TARGETS) !== null
}

function isLetter(key: string): key is Letter {
  return /^[A-Z]$/.test(key)
}
