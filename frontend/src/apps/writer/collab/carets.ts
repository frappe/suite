import type { Peer, RoomPresence } from '@suite/collab-client'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { relativePositionToAbsolutePosition, yCursorPlugin, ySyncPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { fullName, lookUp } from '@/apps/writer/composables/useUsers'

// A guest is named by its tab, so two guests in one document read apart
export function peerName(user: string, peerId: number) {
  if (user === 'Guest') return `Guest ${peerId.toString(36).slice(-4).toUpperCase()}`

  return fullName(user)
}

// One entry per person; every guest tab is its own person
export function peopleOf(peers: Peer[]) {
  const seen = new Set<string>()
  const newPerson = (peer: Peer) => {
    const key = peer.user === 'Guest' ? `${peer.pid}` : peer.user
    if (seen.has(key)) return []

    seen.add(key)
    const person = {
      clientId: peer.pid,
      id: peer.user,
      name: peerName(peer.user, peer.pid),
      color: peer.color,
    }
    return [person]
  }
  return peers.flatMap(newPerson)
}

// Other people's carets, drawn from the room's presence. This tab's own state is client 0, which the
// default filter would draw because it compares against the document's clientID
export const Carets = Extension.create<{ presence: RoomPresence | null }>({
  name: 'collabCarets',
  addOptions: () => ({ presence: null }),
  addProseMirrorPlugins() {
    if (!this.options.presence) return []

    const editor = this.editor
    const awareness = this.options.presence.awareness
    const canPlace = (position: unknown) => {
      const syncState = ySyncPluginKey.getState(editor.state)
      if (!syncState?.binding) return false

      const relative = Y.createRelativePositionFromJSON(position)
      const absolute = relativePositionToAbsolutePosition(
        syncState.doc,
        syncState.type,
        relative,
        syncState.binding.mapping,
      )
      return absolute !== null
    }

    const labelFader = nameFader(awareness)
    const drawCaret = (user: { id: string; color: string }, peerId: number) => {
      const caret = document.createElement('span')
      caret.classList.add('collaboration-carets__caret')
      caret.style.borderColor = user.color

      const label = document.createElement('div')
      label.classList.add('collaboration-carets__label')
      label.style.backgroundColor = user.color
      label.textContent = peerName(user.id, peerId)
      labelFader.track(peerId, label)

      // The plugin keeps a caret's element while the pid stays, so a name that arrives later is filled in
      if (user.id !== 'Guest') {
        void lookUp(user.id).then(() => (label.textContent = peerName(user.id, peerId)))
      }

      caret.append(label)
      return caret
    }
    const shadeSelection = (user: { color: string }) => ({
      class: 'collaboration-carets__selection',
      style: `background-color: ${user.color}${SHADE_ALPHA}`,
    })
    const cursorOptions = {
      awarenessStateFilter: (_: number, id: number) => id !== 0,
      cursorBuilder: drawCaret,
      selectionBuilder: shadeSelection,
    }

    const placedAwareness = withHeldCarets(awareness, canPlace)
    return [
      yCursorPlugin(placedAwareness, cursorOptions),
      new Plugin({ view: () => ({ destroy: labelFader.destroy }) }),
    ]
  },
})

// Alpha appended to a peer's #rrggbb colour, light enough to read the text through two overlapping shades
const SHADE_ALPHA = '33'
const NAME_SHOWN_MS = 3000

// A caret's name shows while its peer moves or types, and fades once they have been still a while
function nameFader(awareness: Awareness) {
  const labels = new Map<number, HTMLElement>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const lastCarets = new Map<number, string>()

  const setLabelIdle = (peerId: number, isIdle: boolean) =>
    labels.get(peerId)?.classList.toggle('collaboration-carets__label--idle', isIdle)

  const forgetPeer = (peerId: number) => {
    clearTimeout(timers.get(peerId))
    for (const map of [labels, timers, lastCarets]) {
      map.delete(peerId)
    }
  }

  const onAwarenessChange = ({ added, updated, removed }: Record<string, number[]>) => {
    removed.forEach(forgetPeer)
    for (const peerId of [...added, ...updated]) {
      const cursor = awareness.getStates().get(peerId)?.cursor ?? null
      const caretJson = JSON.stringify(cursor)
      if (lastCarets.get(peerId) === caretJson) continue

      lastCarets.set(peerId, caretJson)
      setLabelIdle(peerId, false)
      clearTimeout(timers.get(peerId))

      const fade = () => {
        timers.delete(peerId)
        setLabelIdle(peerId, true)
      }
      timers.set(peerId, setTimeout(fade, NAME_SHOWN_MS))
    }
  }

  awareness.on('change', onAwarenessChange)
  return {
    track(peerId: number, label: HTMLElement) {
      labels.set(peerId, label)
      setLabelIdle(peerId, lastCarets.has(peerId) && !timers.has(peerId))
    },
    destroy() {
      awareness.off('change', onAwarenessChange)
      for (const peerId of [...timers.keys()]) {
        forgetPeer(peerId)
      }
    },
  }
}

type Caret = { anchor: unknown; head: unknown }

// A peer's caret can point into text whose row hasn't reached this tab, and the plugin draws no caret it can't
// place. Until it can, the caret stays where it last was placed, which this tab's own edits keep valid
function withHeldCarets(awareness: Awareness, canPlace: (position: unknown) => boolean) {
  const heldCarets = new Map<number, Caret>()
  return {
    getStates() {
      const states = awareness.getStates()
      for (const id of heldCarets.keys()) {
        if (!states.get(id)?.cursor) {
          heldCarets.delete(id)
        }
      }

      const shownStates = new Map<number, object>()
      for (const [id, state] of states) {
        const cursor = state.cursor as Caret | null | undefined
        if (cursor && canPlace(cursor.anchor) && canPlace(cursor.head)) {
          heldCarets.set(id, cursor)
        }

        const shownState = heldCarets.has(id) ? { ...state, cursor: heldCarets.get(id) } : state
        shownStates.set(id, shownState)
      }
      return shownStates
    },
    getLocalState: () => awareness.getLocalState(),
    setLocalStateField: (field: string, value: unknown) =>
      awareness.setLocalStateField(field, value),
    on: (event: 'change', listener: (...args: unknown[]) => void) => awareness.on(event, listener),
    off: (event: 'change', listener: (...args: unknown[]) => void) =>
      awareness.off(event, listener),
  } as unknown as Awareness
}
