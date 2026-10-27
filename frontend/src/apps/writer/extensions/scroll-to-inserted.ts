import { Extension } from '@tiptap/core'
import type { Node, ResolvedPos, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'

import { isReceived } from '@/apps/writer/extensions/received-content-guard'

// A picture often loads after it goes in, and pushes the caret down as it does.
const LOAD_MS = 5000

const insertsKey = new PluginKey<number>('scrollToInserted')

/**
 * Scrolls to a picture, video, table or other block put in from a menu or a
 * dialog, which the editor would leave out of view at the end of a long document.
 * A picture that loads soon after is scrolled to again once it has its height.
 */
export const ScrollToInserted = Extension.create({
  name: 'scrollToInserted',

  addProseMirrorPlugins() {
    let insertedAt = 0
    return [
      new Plugin<number>({
        key: insertsKey,
        state: {
          init: () => 0,
          apply: (tr, inserts) => (isBlockInsert(tr) ? inserts + 1 : inserts),
        },
        view: (view) => {
          // Runs once node views have drawn the new content and have a height.
          const scroll = () => {
            if (!view.isDestroyed) scrollToSelection(view)
          }
          // `load` does not bubble, so it is caught on the way down.
          const onLoad = () => {
            if (Date.now() - insertedAt < LOAD_MS) scroll()
          }
          view.dom.addEventListener('load', onLoad, true)
          return {
            update: (_view, before) => {
              if (insertsKey.getState(view.state) === insertsKey.getState(before)) return
              insertedAt = Date.now()
              requestAnimationFrame(scroll)
            },
            destroy: () => view.dom.removeEventListener('load', onLoad, true),
          }
        },
      }),
    ]
  },
})

/** Shows the whole picture before the caret or table around it, else the caret. */
function scrollToSelection(view: EditorView) {
  const element = view.nodeDOM(insertedPosition(view.state.selection.$head) ?? -1)
  if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' })
  else view.dispatch(view.state.tr.scrollIntoView())
}

// The editor measures no caret right after a picture, so the picture is the target.
function insertedPosition($head: ResolvedPos): number | null {
  const before = $head.nodeBefore
  if (before?.isAtom) return $head.pos - before.nodeSize
  for (let depth = $head.depth; depth > 0; depth--) {
    if ($head.node(depth).type.name === 'table') return $head.before(depth)
  }
  return null
}

function isBlockInsert(tr: Transaction): boolean {
  if (!tr.docChanged || isReceived(tr)) return false
  const size = tr.before.content.size
  return tr.steps.some((step) => {
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false
    // Loading a whole document puts nothing in from a menu.
    const isWholeDocument = step.from === 0 && step.to === size
    return !isWholeDocument && holdsBlock(step.slice)
  })
}

function holdsBlock(slice: Slice): boolean {
  let isFound = false
  slice.content.descendants((node: Node) => {
    isFound ||= (node.isAtom && !node.isText) || node.type.name === 'table'
    return !isFound
  })
  return isFound
}
