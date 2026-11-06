import type { ChainedCommands, Editor } from '@tiptap/core'

export interface BlockStyle {
  value: string
  /** English; translate it where it renders */
  label: string
  icon: string
  isActive: (editor: Editor) => boolean
  apply: (chain: ChainedCommands) => ChainedCommands
}

type Level = 1 | 2 | 3 | 4

function heading(level: Level, label: string): BlockStyle {
  return {
    value: `h${level}`,
    label,
    icon: `lucide-heading-${level}`,
    isActive: (editor) => editor.isActive('heading', { level }),
    apply: (chain) => chain.clearNodes().setHeading({ level }),
  }
}

function block(value: string, label: string, icon: string, apply: BlockStyle['apply']): BlockStyle {
  return { value, label, icon, isActive: (editor) => editor.isActive(value), apply }
}

/** The block styles the toolbar's and bubble menu's style select offer, in menu order. */
export const BLOCK_STYLES: readonly BlockStyle[] = [
  block('paragraph', 'Text', 'lucide-pilcrow', (chain) => chain.clearNodes().setParagraph()),
  heading(1, 'Heading 1'),
  heading(2, 'Heading 2'),
  heading(3, 'Heading 3'),
  heading(4, 'Heading 4'),
  block('bulletList', 'Bulleted list', 'lucide-list', (chain) => chain.toggleBulletList()),
  block('orderedList', 'Numbered list', 'lucide-list-ordered', (chain) =>
    chain.toggleOrderedList(),
  ),
  block('taskList', 'To-do list', 'lucide-list-checks', (chain) => chain.toggleTaskList()),
  block('codeBlock', 'Code block', 'lucide-square-code', (chain) => chain.toggleCodeBlock()),
  block('blockquote', 'Quote', 'lucide-quote', (chain) => chain.toggleBlockquote()),
]

/** The list styles, which the toolbar's Lists menu and the slash menu's Lists group offer. */
export const LIST_STYLES = BLOCK_STYLES.filter((style) =>
  ['bulletList', 'orderedList', 'taskList'].includes(style.value),
)

// Containers before what they contain: a paragraph in a list reads as the list
const PRECEDENCE = [
  'h1',
  'h2',
  'h3',
  'h4',
  'codeBlock',
  'taskList',
  'bulletList',
  'orderedList',
  'blockquote',
  'paragraph',
]

/** The style of the block the selection starts in. */
export function activeBlockStyle(editor: Editor): BlockStyle {
  for (const value of PRECEDENCE) {
    const style = BLOCK_STYLES.find((block) => block.value === value)
    if (style?.isActive(editor)) return style
  }
  return BLOCK_STYLES[0]
}

export interface MarkToggle {
  name: string
  label: string
  icon: string
  shortcut: string
  toggle: (chain: ChainedCommands) => ChainedCommands
}

/** The inline marks the toolbar and bubble menu toggle, in order. */
export const MARKS: readonly MarkToggle[] = [
  {
    name: 'bold',
    label: 'Bold',
    icon: 'lucide-bold',
    shortcut: 'Mod-b',
    toggle: (chain) => chain.toggleBold(),
  },
  {
    name: 'italic',
    label: 'Italic',
    icon: 'lucide-italic',
    shortcut: 'Mod-i',
    toggle: (chain) => chain.toggleItalic(),
  },
  {
    name: 'underline',
    label: 'Underline',
    icon: 'lucide-underline',
    shortcut: 'Mod-u',
    toggle: (chain) => chain.toggleUnderline(),
  },
  {
    name: 'strike',
    label: 'Strikethrough',
    icon: 'lucide-strikethrough',
    shortcut: 'Mod-Shift-s',
    toggle: (chain) => chain.toggleStrike(),
  },
]

const APPLE_KEYS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' }

/**
 * Writes a Tiptap key binding such as `Mod-Shift-s` the way the platform shows it:
 * `⌘⇧S` on Apple devices, `Ctrl+Shift+S` elsewhere.
 */
export function formatShortcut(keys: string, isApple = isApplePlatform()): string {
  const parts = keys.split('-').map((key) => (key.length === 1 ? key.toUpperCase() : key))
  if (isApple) return parts.map((key) => APPLE_KEYS[key] ?? key).join('')
  return parts.map((key) => (key === 'Mod' ? 'Ctrl' : key)).join('+')
}

function isApplePlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

/** Removes any highlight colour from the selection, or highlights it yellow. Keeps the selection. */
export function toggleHighlight(editor: Editor): boolean {
  const chain = editor.chain().focus()
  if (editor.isActive('namedHighlight')) return chain.unsetHighlight().run()
  return chain.setMark('namedHighlight', { color: 'yellow' }).run()
}
