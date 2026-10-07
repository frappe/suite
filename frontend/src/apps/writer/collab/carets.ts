import type { Peer, RoomPresence } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import { relativePositionToAbsolutePosition, yCursorPlugin, ySyncPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { fullName, lookUp } from '@/apps/writer/composables/useUsers'

// A guest is named by its tab, so two guests in one document read apart
export function peerName(user: string, pid: number) {
  if (user === 'Guest') return `Guest ${pid.toString(36).slice(-4).toUpperCase()}`
  return fullName(user)
}

// One entry per person; every guest tab is its own person
export function peopleOf(peers: Peer[]) {
  const seen = new Set<string>()
  return peers.flatMap((peer) => {
    const key = peer.user === 'Guest' ? `${peer.pid}` : peer.user
    if (seen.has(key)) return []
    seen.add(key)
    return [
      { clientId: peer.pid, id: peer.user, name: peerName(peer.user, peer.pid), color: peer.color },
    ]
  })
}

// Other people's carets, drawn from the room's presence. This tab's own state is client 0, which the
// default filter would draw because it compares against the document's clientID
export const Carets = Extension.create<{ presence: RoomPresence | null }>({
  name: 'collabCarets',
  addOptions: () => ({ presence: null }),
  addProseMirrorPlugins() {
    if (!this.options.presence) return []
    const editor = this.editor
    const placed = (position: unknown) => {
      const sync = ySyncPluginKey.getState(editor.state)
      return (
        !!sync?.binding &&
        relativePositionToAbsolutePosition(
          sync.doc,
          sync.type,
          Y.createRelativePositionFromJSON(position),
          sync.binding.mapping,
        ) !== null
      )
    }
    return [
      yCursorPlugin(holding(this.options.presence.awareness, placed), {
        awarenessStateFilter: (_: number, id: number) => id !== 0,
        cursorBuilder: (user: { id: string; color: string }, pid: number) => {
          const caret = document.createElement('span')
          caret.classList.add('collaboration-carets__caret')
          caret.style.borderColor = user.color
          const label = document.createElement('div')
          label.classList.add('collaboration-carets__label')
          label.style.backgroundColor = user.color
          label.textContent = peerName(user.id, pid)
          // The plugin keeps a caret's element while the pid stays, so a name that arrives later is filled in
          if (user.id !== 'Guest')
            void lookUp(user.id).then(() => (label.textContent = peerName(user.id, pid)))
          caret.append(label)
          return caret
        },
        selectionBuilder: () => ({}),
      }),
    ]
  },
})

type Caret = { anchor: unknown; head: unknown }

// A peer's caret can point into text whose row hasn't reached this tab, and the plugin draws no caret it can't
// place. Until it can, the caret stays where it last was placed, which this tab's own edits keep valid
function holding(awareness: Awareness, placed: (position: unknown) => boolean) {
  const held = new Map<number, Caret>()
  return {
    getStates() {
      const states = awareness.getStates()
      for (const id of held.keys()) if (!states.get(id)?.cursor) held.delete(id)
      const shown = new Map<number, object>()
      for (const [id, state] of states) {
        const cursor = state.cursor as Caret | null | undefined
        if (cursor && placed(cursor.anchor) && placed(cursor.head)) held.set(id, cursor)
        shown.set(id, held.has(id) ? { ...state, cursor: held.get(id) } : state)
      }
      return shown
    },
    getLocalState: () => awareness.getLocalState(),
    setLocalStateField: (field: string, value: unknown) =>
      awareness.setLocalStateField(field, value),
    on: (event: 'change', listener: (...args: unknown[]) => void) => awareness.on(event, listener),
    off: (event: 'change', listener: (...args: unknown[]) => void) =>
      awareness.off(event, listener),
  } as unknown as Awareness
}
