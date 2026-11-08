import { GUEST_USER, personKey, roomColours, type PeerColour } from '@/apps/writer/collab/colours'
import { fullName, lookUp } from '@/apps/writer/composables/useUsers'
import type { Peer, RoomPresence } from '@/platform/collab'
import { useSession } from '@/platform/session'

export { GUEST_USER, personKey, roomColours }

const GUEST_TAG_RADIX = 36
const GUEST_TAG_LENGTH = 4

// A guest is named by its tab, so two guests in one document read apart
export function peerName(user: string, peerId: number) {
  if (user === GUEST_USER) {
    const tag = peerId.toString(GUEST_TAG_RADIX).slice(-GUEST_TAG_LENGTH).toUpperCase()
    return `Guest ${tag}`
  }

  return fullName(user)
}

const INITIALS = 2

/** The first letters of a person's first two names, as their avatar shows them. */
export function initialsOf(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, INITIALS)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

// Calls `named` once a signed-in person's full name has been looked up; a guest's name never changes
export async function whenNamed(user: string, named: () => void) {
  if (user !== GUEST_USER) {
    await lookUp(user)
    named()
  }
}

// The colours of everyone in the room, this tab's person included
export function presenceColours(presence: RoomPresence) {
  const own = {
    pid: presence.ownPid,
    user: useSession().user.value?.id ?? GUEST_USER,
    arrival: presence.ownArrival,
    idleSince: null,
  }
  return roomColours(presence.peers, own)
}

// When a tab's person went idle: once every tab of theirs is, from the last to go; null while any is in use
export function personIdleSince(peers: Peer[], peerId: number) {
  const tab = peers.find((peer) => peer.pid === peerId)
  if (!tab) {
    return null
  }

  const person = personKey(tab.user, tab.pid)
  const tabs = peers.filter((peer) => personKey(peer.user, peer.pid) === person)
  const starts = tabs.flatMap((peer) => {
    const mappedValue = peer.idleSince
    return mappedValue !== null ? [mappedValue] : []
  })
  if (starts.length < tabs.length) {
    return null
  }

  return Math.max(...starts)
}

// One entry per person
export function peopleOf(peers: Peer[], colours: Map<number, PeerColour>) {
  const seen = new Set<string>()
  function newPerson(peer: Peer) {
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
