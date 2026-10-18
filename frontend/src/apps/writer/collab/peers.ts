import type { Peer, RoomPresence } from '@suite/collab-client'

import { assignColours, type PeerColour } from '@/apps/writer/collab/colours'
import { fullName, lookUp } from '@/apps/writer/composables/useUsers'
import { useSession } from '@/platform/session'

// A guest is named by its tab, so two guests in one document read apart
export function peerName(user: string, peerId: number) {
  if (user === 'Guest') {
    return `Guest ${peerId.toString(36).slice(-4).toUpperCase()}`
  }

  return fullName(user)
}

// Calls `named` once a signed-in person's full name has been looked up; a guest's name never changes
export function whenNamed(user: string, named: () => void) {
  if (user !== 'Guest') {
    void lookUp(user).then(named)
  }
}

// Who a tab belongs to; every guest tab is its own person
export function personKey(user: string, pid: number) {
  if (user === 'Guest') {
    return `Guest ${pid}`
  }

  return user
}

// Each tab's colour. People rank by their first tab's arrival, then by key, so every tab in the room
// ranks the same set the same way and a clash moves the later arrival
export function roomColours(peers: Peer[], own: Peer) {
  const tabs = [own, ...peers]
  const firstArrivals = new Map<string, number>()
  for (const { user, pid, arrival } of tabs) {
    const key = personKey(user, pid)
    const first = Math.min(arrival ?? Infinity, firstArrivals.get(key) ?? Infinity)
    firstArrivals.set(key, first)
  }

  const ranked = [...firstArrivals].sort(byArrivalThenKey).map(([key]) => key)
  const colours = assignColours(ranked)
  const tabColours = new Map<number, PeerColour>()
  for (const { user, pid } of tabs) {
    tabColours.set(pid, colours.get(personKey(user, pid))!)
  }

  return tabColours
}

// Plain code-unit order for keys, the same in every locale
function byArrivalThenKey(
  [key, arrival]: [string, number],
  [otherKey, otherArrival]: [string, number],
) {
  if (arrival !== otherArrival) {
    return Math.sign(arrival - otherArrival)
  }

  return Number(key > otherKey) - Number(key < otherKey)
}

// The colours of everyone in the room, this tab's person included
export function presenceColours(presence: RoomPresence) {
  const own = {
    pid: presence.ownPid,
    user: useSession().user.value?.id ?? 'Guest',
    arrival: presence.ownArrival,
    idleSince: null,
  }
  return roomColours(presence.peers, own)
}

// When a tab's person went idle: once every tab of theirs is, from the last to go; null while any is in use
export function personIdleSince(peers: Peer[], pid: number) {
  const tab = peers.find((peer) => peer.pid === pid)
  if (!tab) {
    return null
  }

  const person = personKey(tab.user, tab.pid)
  const tabs = peers.filter((peer) => personKey(peer.user, peer.pid) === person)
  const starts = tabs.map((peer) => peer.idleSince)
  if (starts.includes(null)) {
    return null
  }

  return Math.max(...(starts as number[]))
}

// One entry per person
export function peopleOf(peers: Peer[], colours: Map<number, PeerColour>) {
  const seen = new Set<string>()
  const newPerson = (peer: Peer) => {
    const key = personKey(peer.user, peer.pid)
    if (seen.has(key)) {
      return []
    }

    seen.add(key)
    const person = {
      clientId: peer.pid,
      id: peer.user,
      name: peerName(peer.user, peer.pid),
      colour: colours.get(peer.pid),
      idleSince: personIdleSince(peers, peer.pid),
    }
    return [person]
  }
  return peers.flatMap(newPerson)
}
