import { Extension } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'

import * as Y from 'yjs'
export const commentPluginKey = new PluginKey('comment-anchors')

export const rebuild = (editor) => {
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta(commentPluginKey, { rebuild: true })
      return true
    })
    .run()
}

export const getEditorPos = (relativePos, editor) => {
  const ystate = ySyncPluginKey.getState(editor.state)
  const collab = editor.extensionManager.extensions.find((ext) => ext.name === 'collaboration')

  return relativePositionToAbsolutePosition(
    collab?.options.document,
    ystate.type,
    Y.decodeRelativePosition(relativePos),
    ystate.binding.mapping,
  )
}

const createDecorations = (state, yDoc, comments, active, showResolved) => {
  try {
    if (!comments._map.size) return DecorationSet.empty
    const ystate = ySyncPluginKey.getState(state)
    const decos = []
    comments.forEach((comment) => {
      if (!comment.anchor.from || (!showResolved && comment.resolved) || !ystate) return
      const from = relativePositionToAbsolutePosition(
        yDoc,
        ystate.type,
        Y.decodeRelativePosition(comment.anchor.from),
        ystate.binding.mapping,
      )
      const to = relativePositionToAbsolutePosition(
        yDoc,
        ystate.type,
        Y.decodeRelativePosition(comment.anchor.to),
        ystate.binding.mapping,
      )

      decos.push(
        Decoration.inline(from, to, {
          nodeName: 'span',
          class: comment.id === active ? 'active' : '',
          'data-comment-name': comment.id,
          'data-resolved': comment.resolved,
        }),
      )
    })
    return DecorationSet.create(state.doc, decos)
  } catch (e) {
    return DecorationSet.empty
  }
}
export const CommentExtension = Extension.create({
  name: 'commentExtension',

  addOptions() {
    return {
      comments: [],
      doc: null,
      activeComment: null,
      onActivated: null,
      onDecorationsPainted: null,
    }
  },

  addProseMirrorPlugins() {
    const ext = this

    return [
      new Plugin({
        key: commentPluginKey,
        state: {
          init(_, state) {
            const { doc, comments, activeComment, showResolved, onDecorationsPainted } = ext.options
            const decos = createDecorations(
              state,
              doc,
              comments,
              activeComment.value,
              showResolved.value,
            )
            comments.observe((val) => {
              rebuild(ext.editor)
            })
            if (onDecorationsPainted) setTimeout(onDecorationsPainted, 100)
            return decos
          },

          apply(tr, oldSet, oldState, newState) {
            const { doc, comments, activeComment, showResolved } = ext.options
            const shouldRebuild = tr.getMeta(commentPluginKey)?.rebuild
            if ((!tr.docChanged && !shouldRebuild) || !comments._map.size) return oldSet

            const isRemote = tr.getMeta('y-sync$')?.isChangeOrigin
            if (isRemote || shouldRebuild) {
              return createDecorations(
                newState,
                doc,
                comments,
                activeComment.value,
                showResolved.value,
              )
            }
            return oldSet.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return commentPluginKey.getState(state)
          },

          handleClick(view, pos, event) {
            const el = event.target.closest('[data-comment-name]')
            if (el) {
              const id = el.getAttribute('data-comment-name')
              ext.options.onActivated?.(id)
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})
