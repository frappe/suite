import type { Peer, RoomPresence } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import { yCursorPlugin } from '@tiptap/y-tiptap'

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
    return [
      yCursorPlugin(this.options.presence.awareness, {
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
