import type { Peer } from '@suite/collab-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assignColours, PALETTE } from './colours'
import { peopleOf, personIdleSince, roomColours } from './peers'

const searchUsers = vi.hoisted(() => vi.fn())
vi.mock('@/apps/writer/drive', () => ({ searchUsers }))

const PEER_ID = 2 ** 31 + 7

// The palette slot a person takes when nobody else is in the room
function ownSlot(person: string) {
  return PALETTE.indexOf(assignColours([person]).get(person)!)
}

// `count` people whose own colours are all the same
function clashing(count: number) {
  const bySlot = new Map<number, string[]>()
  for (let index = 0; ; index++) {
    const person = `person${index}@x.com`
    const sharing = bySlot.get(ownSlot(person)) ?? []
    sharing.push(person)
    if (sharing.length === count) {
      return sharing
    }

    bySlot.set(ownSlot(person), sharing)
  }
}

// One person whose own colour differs from each of `others`
function apart(...others: string[]) {
  const taken = others.map(ownSlot)
  for (let index = 0; ; index++) {
    const person = `apart${index}@x.com`
    if (!taken.includes(ownSlot(person))) {
      return person
    }
  }
}

function tab(
  pid: number,
  user: string,
  arrival: number | null,
  idleSince: number | null = null,
): Peer {
  return { pid, user, arrival, idleSince }
}

// What one tab computes: itself as own, everyone else as peers in the order it heard them
function seenFrom(own: Peer, everyone: Peer[]) {
  const peers = everyone.filter((peer) => peer.pid !== own.pid)
  return roomColours(peers, own)
}

describe('Writer peers', () => {
  beforeEach(() => {
    searchUsers.mockResolvedValue([])
  })

  it('reads a person as idle only once every tab of theirs is, from the last to go', () => {
    const cyIdle = tab(PEER_ID, 'cy@x.com', 1, 100)
    const cyInUse = tab(PEER_ID + 1, 'cy@x.com', 2)
    const cyIdleLater = tab(PEER_ID + 1, 'cy@x.com', 2, 400)
    const dee = tab(PEER_ID + 2, 'dee@x.com', 3, 50)

    const whileOneTabIsInUse = personIdleSince([cyIdle, cyInUse, dee], PEER_ID)
    const onceBothAreIdle = personIdleSince([cyIdle, cyIdleLater, dee], PEER_ID)
    const people = peopleOf([cyIdle, cyIdleLater, dee], new Map())

    expect([whileOneTabIsInUse, onceBothAreIdle]).toEqual([null, 400])
    expect(people.map((person) => person.idleSince)).toEqual([400, 50])
  })

  it('lists each signed-in person once and every guest tab apart', () => {
    const peers: Peer[] = [
      tab(PEER_ID, 'cy@x.com', 1),
      tab(PEER_ID + 1, 'cy@x.com', 2),
      tab(2 ** 31 + 1_000_000, 'Guest', 3),
      tab(2 ** 31 + 2_000_000, 'Guest', 4),
    ]

    const people = peopleOf(peers, new Map())

    expect(people.map((person) => person.id)).toEqual(['cy@x.com', 'Guest', 'Guest'])
    expect(people[1].name).toMatch(/^Guest [0-9A-Z]{4}$/)
    expect(people[1].name).not.toBe(people[2].name)
  })

  it('gives a person the same colour in every tab and every session while nobody clashes', () => {
    const [cy] = clashing(1)
    const firstViewer = apart(cy)
    const secondViewer = apart(cy, firstViewer)

    const inFirst = seenFrom(tab(1, firstViewer, 1), [tab(2, cy, 2), tab(3, cy, 9)])
    const inSecond = seenFrom(tab(4, secondViewer, 7), [tab(5, cy, 3)])

    expect(inFirst.get(2)).toBe(PALETTE[ownSlot(cy)])
    expect(inFirst.get(3)).toBe(PALETTE[ownSlot(cy)])
    expect(inSecond.get(5)).toBe(PALETTE[ownSlot(cy)])
  })

  it('moves the later arrival to the next free colour while two people share one', () => {
    const [earlier, later] = clashing(2)
    const slot = ownSlot(earlier)

    const colours = seenFrom(tab(1, earlier, 1), [tab(2, later, 2)])
    const people = peopleOf([tab(2, later, 2)], colours)

    expect(colours.get(1)).toBe(PALETTE[slot])
    expect(colours.get(2)).toBe(PALETTE[(slot + 1) % PALETTE.length])
    expect(people[0].colour).toBe(PALETTE[(slot + 1) % PALETTE.length])
  })

  it('gives every viewer the same colours in a three-way clash, whatever order each heard the room in', () => {
    const [first, second, third] = clashing(3)
    const slot = ownSlot(first)
    const everyone = [tab(1, first, 1), tab(2, second, 2), tab(3, third, 3), tab(4, second, 4)]
    const heardOrders = [
      everyone,
      [...everyone].reverse(),
      [everyone[2], everyone[0], everyone[3], everyone[1]],
    ]

    const views = everyone.flatMap((own) =>
      heardOrders.map((order) =>
        [...seenFrom(own, order)].sort(([pid], [otherPid]) => pid - otherPid),
      ),
    )

    const expected = [
      [1, PALETTE[slot]],
      [2, PALETTE[(slot + 1) % PALETTE.length]],
      [3, PALETTE[(slot + 2) % PALETTE.length]],
      [4, PALETTE[(slot + 1) % PALETTE.length]],
    ]
    for (const view of views) {
      expect(view).toEqual(expected)
    }
  })

  it('gives two viewers the same colours when a peer’s arrival is unknown, ranking it after everyone with one', () => {
    const [known, unknown] = clashing(2)
    const viewer = apart(known)
    const slot = ownSlot(known)
    const everyone = [tab(1, viewer, 1), tab(2, unknown, null), tab(3, known, 5)]

    const oneView = [...seenFrom(everyone[0], everyone)]
    const otherView = [...seenFrom(everyone[2], [...everyone].reverse())]

    expect(new Map(oneView)).toEqual(new Map(otherView))
    expect(new Map(oneView).get(3)).toBe(PALETTE[slot])
    expect(new Map(oneView).get(2)).not.toBe(PALETTE[slot])
  })
})
