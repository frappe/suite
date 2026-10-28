import { Extension, getMarkRange, type Editor, type Range } from '@tiptap/core'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkEditing: {
      /** Leaves the link editor without changing the link. */
      closeLinkEditor: () => ReturnType
    }
  }
}

const linkEditingKey = new PluginKey<boolean>('linkEditing')

/** The plugin keys of the link popover's and the selection's bubble menus. */
export const LINK_POPOVER = 'linkPopover'
export const SELECTION_MENU = 'selectionMenu'

/** Whether the link editor is open over the selection. */
export function isEditingLink(state: EditorState): boolean {
  return linkEditingKey.getState(state) ?? false
}

/** The link the caret is in, or the selection. */
export function linkRange(state: EditorState): Range | null {
  const { selection, schema } = state
  if (!selection.empty) return { from: selection.from, to: selection.to }
  return getMarkRange(selection.$from, schema.marks.link) ?? null
}

/** Links the selection to `href`. With only a caret, inserts `href` as linked text. */
export function applyLink(editor: Editor, href: string): boolean {
  const { to, empty } = editor.state.selection
  const chain = editor.chain().focus()
  const linked = empty
    ? chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
    : chain.setLink({ href }).setTextSelection(to)
  return linked
    .command(({ tr }) => {
      tr.setStoredMarks([])
      tr.setMeta(linkEditingKey, false)
      return true
    })
    .run()
}

/** Removes the link the caret is in, or the links in the selection, and keeps the selection. */
export function removeLink(editor: Editor): boolean {
  const { from, to } = editor.state.selection
  return editor
    .chain()
    .focus()
    .extendMarkRange('link')
    .unsetLink()
    .setTextSelection({ from, to })
    .command(({ tr }) => {
      tr.setMeta(linkEditingKey, false)
      return true
    })
    .run()
}

/** A link the editor accepts: http(s), mail and phone links, and paths in this site. */
export function normalizeHref(value: string): string | null {
  const href = value.trim()
  if (/^[/#]/.test(href)) return href
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (['mailto:', 'tel:'].includes(url.protocol)) return withScheme
  if (!['http:', 'https:'].includes(url.protocol)) return null
  return url.hostname === 'localhost' || url.hostname.includes('.') ? withScheme : null
}

/**
 * Opens Writer's link popover in place of frappe-ui's link popup, for the toolbar, the bubble
 * menu, the slash menu and Mod-k. Tiptap's Link runs first, so this `openLinkEditor` wins.
 */
export const LinkEditing = Extension.create({
  name: 'linkEditing',

  addCommands() {
    return {
      openLinkEditor:
        () =>
        ({ state, tr, dispatch }) => {
          if (!state.schema.marks.link) return false
          const range = linkRange(state) ?? state.selection
          if (dispatch) {
            tr.setSelection(TextSelection.create(tr.doc, range.from, range.to))
            setEditing(tr, true)
          }
          return true
        },
      closeLinkEditor:
        () =>
        ({ state, tr, dispatch }) => {
          if (!isEditingLink(state)) return false
          if (dispatch) setEditing(tr, false)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: linkEditingKey,
        state: {
          init: () => false,
          apply: (tr, editing) => tr.getMeta(linkEditingKey) ?? (tr.selectionSet ? false : editing),
        },
      }),
    ]
  },
})

/** Bubble menus only look again when the selection or document changes, so tell them. */
function setEditing(tr: Transaction, editing: boolean) {
  const { selection, doc } = tr
  const inLink = selection.empty && !!getMarkRange(selection.$from, doc.type.schema.marks.link)
  tr.setMeta(linkEditingKey, editing)
  tr.setMeta(SELECTION_MENU, editing || selection.empty ? 'hide' : 'show')
  tr.setMeta(LINK_POPOVER, editing || inLink ? 'show' : 'hide')
}
