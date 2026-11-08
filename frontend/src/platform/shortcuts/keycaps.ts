import type { KeyboardShortcutCombo } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import type { Letter } from './keySequences'

/**
 * How the shortcuts dialog draws a key. On a Mac every modifier and special key
 * is the glyph printed on Apple keyboards, with modifiers in Apple's order
 * (⌃ ⌥ ⇧ ⌘). Elsewhere each one is a word, in Ctrl, Alt, Shift order. One rule
 * holds for every row, so a glyph never sits next to a word.
 */
export interface Keycap {
  /** What the cap shows: `⌘`, `Ctrl`, `K`. */
  label: string
  /** What a screen reader says for it: `Command`, `Control`, `K`. */
  spoken: string
}

/** Keys pressed together. */
export type KeyStroke = readonly Keycap[]

/** Punctuation and digit key names in frappe-ui's combo grammar, as the character they type. */
const CHARACTERS = new Map<string, string>(
  Object.entries({
    slash: '/',
    backslash: '\\',
    backtick: '`',
    comma: ',',
    period: '.',
    semicolon: ';',
    quote: "'",
    bracketleft: '[',
    bracketright: ']',
    minus: '-',
    equal: '=',
    plus: '+',
  }),
)

/** True on an Apple platform, where `Mod` is Command. Agrees with frappe-ui's matcher. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /Mac|iPod|iPhone|iPad/i.test(navigator.platform) ||
    /Mac OS X|Macintosh|iPhone|iPad|iPod/i.test(navigator.userAgent)
  )
}

/** The caps for a frappe-ui combo such as `Mod+Shift+K`. `Shift+Slash` is drawn as `?`. */
export function comboKeycaps(combo: KeyboardShortcutCombo, mac: boolean): KeyStroke {
  const parts = combo.split('+').map((part) => part.toLowerCase())
  const key = parts.pop() ?? ''
  const held = new Set(parts)
  if (key === 'slash' && held.delete('shift')) return [...modifierCaps(held, mac), plain('?')]
  return [...modifierCaps(held, mac), keyCap(key, mac)]
}

/** The cap for one letter key. */
export function letterKeycap(letter: Letter): Keycap {
  return plain(letter)
}

function modifierCaps(held: ReadonlySet<string>, mac: boolean): Keycap[] {
  const caps: Keycap[] = []
  if (mac) {
    if (held.has('ctrl')) caps.push({ label: '⌃', spoken: __('Control') })
    if (held.has('alt')) caps.push({ label: '⌥', spoken: __('Option') })
    if (held.has('shift')) caps.push({ label: '⇧', spoken: __('Shift') })
    if (held.has('mod')) caps.push({ label: '⌘', spoken: __('Command') })
    return caps
  }
  // `Mod` is Control off a Mac, so `Mod+Ctrl` is one key.
  if (held.has('mod') || held.has('ctrl')) caps.push({ label: __('Ctrl'), spoken: __('Control') })
  if (held.has('alt')) caps.push(plain(__('Alt')))
  if (held.has('shift')) caps.push(plain(__('Shift')))
  return caps
}

function keyCap(key: string, mac: boolean): Keycap {
  const special = specialKeys(mac)
  const named = special.get(key)
  if (named) return named
  const character = CHARACTERS.get(key)
  if (character !== undefined) return plain(character)
  if (/^digit\d$/.test(key)) return plain(key.slice(-1))
  if (key.length === 1 || /^f\d+$/.test(key)) return plain(key.toUpperCase())
  return plain(key.charAt(0).toUpperCase() + key.slice(1))
}

function specialKeys(mac: boolean) {
  const everywhere = {
    arrowup: { label: '↑', spoken: __('Up arrow') },
    arrowdown: { label: '↓', spoken: __('Down arrow') },
    arrowleft: { label: '←', spoken: __('Left arrow') },
    arrowright: { label: '→', spoken: __('Right arrow') },
    space: plain(__('Space')),
  }
  if (mac) {
    return new Map(
      Object.entries({
        ...everywhere,
        escape: { label: '⎋', spoken: __('Escape') },
        enter: { label: '↩', spoken: __('Return') },
        backspace: { label: '⌫', spoken: __('Delete') },
        delete: { label: '⌦', spoken: __('Forward delete') },
        tab: { label: '⇥', spoken: __('Tab') },
        home: { label: '↖', spoken: __('Home') },
        end: { label: '↘', spoken: __('End') },
        pageup: { label: '⇞', spoken: __('Page up') },
        pagedown: { label: '⇟', spoken: __('Page down') },
      }),
    )
  }
  return new Map(
    Object.entries({
      ...everywhere,
      escape: { label: __('Esc'), spoken: __('Escape') },
      enter: plain(__('Enter')),
      backspace: plain(__('Backspace')),
      delete: plain(__('Delete')),
      tab: plain(__('Tab')),
      home: plain(__('Home')),
      end: plain(__('End')),
      pageup: plain(__('Page up')),
      pagedown: plain(__('Page down')),
    }),
  )
}

function plain(label: string): Keycap {
  return { label, spoken: label }
}
