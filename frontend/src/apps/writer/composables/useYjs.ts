import type { Editor } from '@tiptap/core'
import { absolutePositionToRelativePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import { debounce } from 'frappe-ui'
import { fromUint8Array, toUint8Array } from 'js-base64'
import { ref, type Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'
import * as Y from 'yjs'

import { rebuild } from '@/apps/writer/extensions/comments'
import type { WriterDocument, WriterDocumentRow } from '@/apps/writer/surface/writerDocument'

import { reportSaveError } from './saveError'
import { SERVER_ORIGIN, trackUnsaved } from './unsaved'
import { useCollaborationUsers } from './useCollaborationUsers'

const REALTIME_CONFIG = {
  signaling: ['wss://signal.frappe.cloud'],
  peerOpts: {
    config: {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302',
        },
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
type LoadedDocument = Omit<WriterDocument, 'doc'> & { doc: WriterDocumentRow }
export const useComments = (document: LoadedDocument, editor: Ref<Editor | null>) => {
  const commentsDoc = new Y.Doc()
  if (document.doc.ycomments) {
    Y.applyUpdate(commentsDoc, toUint8Array(document.doc.ycomments))
  }
  const dbComments = new IndexeddbPersistence('wdoc-comments-' + document.doc.name, commentsDoc)
  const providerComments = new WebrtcProvider(
    'wdoc-comments-' + document.doc.name,
    commentsDoc,
    REALTIME_CONFIG,
  )
  const comments = commentsDoc.getMap('comments')
  const newComment = (id: string, from: number, to: number, owner: string, anchorText: string) => {
    if (!editor.value) return
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
          absolutePositionToRelativePosition(from, ystate.type, ystate.binding.mapping),
        ),
        to: Y.encodeRelativePosition(
          absolutePositionToRelativePosition(to, ystate.type, ystate.binding.mapping),
        ),
      },
    })
    rebuild(editor.value)
  }
  const saveComments = async () => {
    const data = fromUint8Array(Y.encodeStateAsUpdate(commentsDoc))
    try {
      await document.saveComments.run({
        doc: document.doc.name,
        data,
      })
    } catch (error) {
      reportSaveError(error)
    }
  }
  const cleanup = () => {
    providerComments.destroy()
    dbComments.destroy()
  }
  return {
    saveComments,
    newComment,
    comments,
    cleanup,
  }
}
export function useYjs(
  id: string,
  document: LoadedDocument,
  editor: Ref<Editor | null>,
  edited: Ref<boolean>,
) {
  const doc = new Y.Doc({
    gc: true,
  })
  if (document.doc.content) Y.applyUpdate(doc, toUint8Array(document.doc.content), SERVER_ORIGIN)
  const roomName = 'fdoc-' + id
  const db = new IndexeddbPersistence(roomName, doc)
  const loaded = ref(false)
  db.on('synced', () => (loaded.value = true))

  // Saving to server. `edited` is the header's unsaved flag: the tracker sets
  // it on every change to store and clears it once a save has landed.
  const save = async (manual = false, oldHtml = '') => {
    if (!manual && !edited.value) return
    await unsavedTracking.storeThrough(async () => {
      const html = editor.value ? editor.value.getHTML() : oldHtml || ''
      const yjsState = Y.encodeStateAsUpdate(doc)
      await document.saveDoc.run({
        data: fromUint8Array(yjsState),
        html,
      })
    })
  }
  const autosave = debounce(() => {
    void save().catch(reportSaveError)
  }, 5000)
  const unsavedTracking = trackUnsaved(doc, edited, () => autosave())

  // WebRTC for real-time P2P collaboration
  const provider = new WebrtcProvider(roomName, doc, REALTIME_CONFIG)
  const { peers, cleanup: cleanupPeers } = useCollaborationUsers(provider.awareness)
  // Comments
  const { cleanup: cleanupComments, ...commentsData } = useComments(document, editor)
  return {
    doc,
    cleanup: () => {
      cleanupPeers()
      provider.destroy()
      db.destroy()
      cleanupComments()
    },
    save,
    provider,
    peers,
    loaded,
    ...commentsData,
  }
}
