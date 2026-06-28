import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'
import { toUint8Array, fromUint8Array } from 'js-base64'
import { debounce, toast, FrappeNetworkError } from 'frappe-ui'
import {
  absolutePositionToRelativePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap'
import { rebuild } from '@/apps/writer/extensions/comments'
import { inject, ref } from 'vue'
import { updateComments } from '@/apps/writer/resources'

import { useSessionStore } from '@/boot/session'

const REALTIME_CONFIG = {
  signaling: ['wss://signal.frappe.cloud'],
  peerOpts: {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: [
            'turn:signal.frappe.cloud:3478?transport=udp',
            'turn:signal.frappe.cloud:3478?transport=tcp',
          ],
          username: 'turnuser',
          credential: 'turnpass',
        },
      ],
    },
  },
}

export const useComments = (document, editor) => {
  const commentsDoc = new Y.Doc()
  if (document.doc.ycomments) {
    Y.applyUpdate(commentsDoc, toUint8Array(document.doc.ycomments))
  }

  const dbComments = new IndexeddbPersistence(
    'wdoc-comments-' + document.doc.name,
    commentsDoc,
  )
  const providerComments = new WebrtcProvider(
    'wdoc-comments-' + document.doc.name,
    commentsDoc,
    REALTIME_CONFIG,
  )

  const comments = commentsDoc.getMap('comments')
  const newComment = (id, from, to, owner, anchorText) => {
    const ystate = ySyncPluginKey.getState(editor.value.view.state)
    comments.set(id, {
      id,
      new: true,
      creation: Date.now(),
      owner,
      replies: [],
      anchorText,
      anchor: {
        from: Y.encodeRelativePosition(
          absolutePositionToRelativePosition(
            from,
            ystate.type,
            ystate.binding.mapping,
          ),
        ),
        to: Y.encodeRelativePosition(
          absolutePositionToRelativePosition(
            to,
            ystate.type,
            ystate.binding.mapping,
          ),
        ),
      },
    })
    rebuild(editor.value)
  }
  const saveComments = async () => {
    const data = fromUint8Array(Y.encodeStateAsUpdate(commentsDoc))
    updateComments.submit({ doc: document.doc.name, data })
  }
  const cleanup = () => {
    providerComments.destroy()
    dbComments.destroy()
  }
  return { saveComments, newComment, comments, cleanup }
}

export function useYjs(id, document, editor, edited) {
  const isOffline = inject('isOffline')
  const doc = new Y.Doc({ gc: true })
  if (document.doc.content)
    Y.applyUpdate(doc, toUint8Array(document.doc.content), 'server')
  const roomName = 'fdoc-' + id
  const db = new IndexeddbPersistence(roomName, doc)
  const loaded = ref(false)
  db.on('synced', () => (loaded.value = true))

  new Promise((resolve) => {
    if (document.isFinished) resolve(document.doc)
    else {
      const stop = document.onSuccess((freshDoc) => {
        const diff = Y.diffUpdate(
          toUint8Array(freshDoc.content),
          Y.encodeStateVector(doc),
        )
        Y.applyUpdate(doc, diff, 'server')
        stop()
      })
    }
  })

  // Saving to server
  const save = async (manual = false, oldHtml) => {
    if (!manual && !edited.value) return
    // Compute a diff relative to server’s last known state
    const html = editor.value ? editor.value.getHTML() : oldHtml || ''
    const yjsState = Y.encodeStateAsUpdate(doc)
    const data = await document.saveDoc.submit({
      data: fromUint8Array(yjsState),
      html,
    })
    if (data?.skipped) {
      console.log(
        'Server skipped update - probably because other people are collaborating',
      )
    } else if (document.saveDoc.error) {
      if (isOffline.value) {
        console.warn('Skipping save as client is offline.')
      } else {
        toast.error('Could not save the document.')
        // ideally store in indexeddb
        localStorage.setItem('errored-save-out-' + id + '-' + Date.now(), html)
      }
      throw new Error(`Server error during save: ${document.saveDoc.error}`)
    }
  }

  const autosave = debounce(save, 5000)
  doc.on('update', (_, origin) => {
    if (origin && origin !== 'server') autosave()
  })

  // WebRTC for real-time P2P collaboration
  const provider = new WebrtcProvider(roomName, doc, REALTIME_CONFIG)
  const permanentUserData = new Y.PermanentUserData(doc)
  permanentUserData.setUserMapping(doc, doc.clientID, useSessionStore().user)

  // Comments
  const { cleanup: cleanupComments, ...commentsData } = useComments(
    document,
    editor,
  )
  return {
    doc,
    cleanup: () => {
      provider.destroy()
      db.destroy()
      cleanupComments()
    },
    save,
    provider,
    permanentUserData,
    loaded,
    ...commentsData,
  }
}
