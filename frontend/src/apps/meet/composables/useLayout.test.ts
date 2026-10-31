import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { Participant } from '../utils/media/ParticipantManager'
import type { PinnedTile } from './useGridLayout'
import { useLayout } from './useLayout'

const viewport = vi.hoisted(() => ({ sidebarColumns: 1 }))

vi.mock('./useResponsiveGrid', () => ({
  useResponsiveGrid: () => ({
    isMobile: ref(false),
    maxColumns: ref(1),
    sidebarMaxColumns: ref(viewport.sidebarColumns),
  }),
}))

describe('useLayout', () => {
  it('uses the tile normally reserved for local media when configured with zero local tiles', () => {
    const participants = Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [
        `p${index}`,
        { user_id: `p${index}`, user_name: `P${index}` },
      ]),
    )
    const deps = {
      raisedHands: ref({}),
      activeSpeakerIds: ref<string[]>([]),
      stableSpeakerIds: ref<string[]>([]),
    }
    const normal = useLayout(ref(participants) as never, ref([]), deps, ref(0))
    const recorder = useLayout(ref(participants) as never, ref([]), deps, ref(0), {
      localTileCount: 0,
    })

    expect(normal.displayParticipants.value.list).toHaveLength(2)
    expect(recorder.displayParticipants.value.list).toHaveLength(4)
    expect(recorder.visibleTileCount.value).toBe(4)
  })
})

function setupLayout(pinned: PinnedTile[] = []) {
  const participants = ref<Record<string, Participant>>(
    Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e'].map((id) => [
        id,
        {
          user_id: id,
          user_name: id,
          avatar: null,
          initials: id,
          video_enabled: true,
        },
      ]),
    ),
  )
  const deps = {
    raisedHands: ref<Record<string, string>>({}),
    activeSpeakerIds: ref<string[]>([]),
    stableSpeakerIds: ref<string[]>([]),
  }
  const pins = ref(pinned)
  const layout = useLayout(participants, pins, deps, ref(0))
  const visibleIds = () => layout.displayParticipants.value.list.map((p) => p.user_id)
  return { participants, deps, layout, visibleIds }
}

describe('participant promotion', () => {
  it('selects participants using the agreed seven-level ranking', () => {
    const participants = ref<Record<string, Participant>>(
      Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => [
          id,
          {
            user_id: id,
            user_name: id,
            avatar: null,
            initials: id,
            video_enabled: ['a', 'd', 'f'].includes(id),
          },
        ]),
      ),
    )
    const deps = {
      activeSpeakerIds: ref(['a', 'b']),
      stableSpeakerIds: ref(['d', 'e']),
      raisedHands: ref<Record<string, string>>({ c: '2026-10-01T10:00:00Z' }),
    }
    const layout = useLayout(participants, ref([]), deps, ref(0), { localTileCount: 0 })
    const visibleIds = () => layout.displayParticipants.value.list.map((p) => p.user_id).sort()
    expect(visibleIds()).toEqual(['a', 'b', 'c'])
    deps.activeSpeakerIds.value = ['b']
    expect(visibleIds()).toEqual(['b', 'c', 'd'])
    deps.activeSpeakerIds.value = []
    expect(visibleIds()).toEqual(['c', 'd', 'e'])
    deps.raisedHands.value = {}
    expect(visibleIds()).toEqual(['a', 'd', 'e'])
    deps.stableSpeakerIds.value = []
    expect(visibleIds()).toEqual(['a', 'd', 'f'])
  })

  it.each(['grid', 'sidebar'])(
    'shows both raised hands instead of lower-ranked camera tiles in %s',
    (mode) => {
      const { participants, deps, visibleIds, layout } = setupLayout(
        mode === 'sidebar' ? [{ type: 'screenshare', id: 'share' }] : [],
      )
      expect(visibleIds()).toEqual(['a', 'b'])
      participants.value.d.video_enabled = false
      deps.raisedHands.value = { d: '2026-10-01T10:00:00Z', e: '2026-10-01T10:00:01Z' }
      expect(visibleIds()).toEqual(['d', 'e'])
      expect(layout.displayParticipants.value.hidden.map((p) => p.user_id)).toEqual(['a', 'b', 'c'])
    },
  )

  it('gives earlier raised hands visibility when there is no space for the entire queue', () => {
    const { deps, visibleIds } = setupLayout()
    expect(visibleIds()).toEqual(['a', 'b'])
    deps.raisedHands.value = { b: '2026-10-01T10:00:02Z' }
    expect(visibleIds()).toEqual(['b', 'a'])
    deps.raisedHands.value = { ...deps.raisedHands.value, e: '2026-10-01T10:00:03Z' }
    expect(visibleIds()).toEqual(['b', 'e'])
    deps.raisedHands.value = { ...deps.raisedHands.value, d: '2026-10-01T10:00:01Z' }
    expect(visibleIds()).toEqual(['d', 'b'])
  })

  it('projects the same shared order despite different inventory insertion and previous views', () => {
    const first = setupLayout(),
      second = setupLayout()
    const ranking = ref(['d', 'c', 'b', 'a', 'e'])
    const left = useLayout(
      first.participants,
      ref([]),
      { ...first.deps, sharedStageParticipantIds: ranking },
      ref(0),
    )
    const rightParticipants = ref(
      Object.fromEntries(Object.entries(second.participants.value).reverse()),
    )
    const pins = ref<PinnedTile[]>([{ type: 'participant', id: 'e' }])
    const right = useLayout(
      rightParticipants,
      pins,
      { ...second.deps, sharedStageParticipantIds: ranking },
      ref(0),
    )
    const ids = (layout: ReturnType<typeof useLayout>) =>
      layout.displayParticipants.value.list.map((p) => p.user_id)
    expect(ids(left)).toEqual(['d', 'c'])
    expect(ids(right)).toContain('e')
    pins.value = []
    expect(ids(right)).toEqual(['d', 'c'])
    ranking.value = ['b', 'd', 'c', 'a', 'e']
    expect(ids(left)).toEqual(['b', 'd'])
    expect(ids(right)).toEqual(['b', 'd'])
    const larger = useLayout(
      rightParticipants,
      ref([]),
      { ...second.deps, sharedStageParticipantIds: ranking },
      ref(0),
      { localTileCount: 0 },
    )
    expect(ids(larger)).toEqual(['b', 'd', 'c'])
    // Self is removed from remote inventory before projection; it keeps its local tile.
    delete rightParticipants.value.b
    expect(ids(right)).toEqual(['d', 'c'])
    expect(ids(right)).not.toContain('b')
  })
})

describe('server-owned presentation', () => {
  it('uses shared slots rather than ranking, including a fresh late viewer and reconnect', () => {
    const { participants, deps } = setupLayout()
    const ranking = ref(['e', 'a', 'b', 'c', 'd'])
    const orders = ref({ '2': ['a', 'e'], '3': ['a', 'b', 'e'] })
    const shared = {
      ...deps,
      sharedStageParticipantIds: ranking,
      sharedStagePresentationOrders: orders,
    }
    const first = useLayout(participants, ref([]), shared, ref(0))
    expect(first.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'e'])
    ranking.value = ['a', 'e', 'b', 'c', 'd']
    expect(first.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'e'])
    const late = useLayout(
      ref(Object.fromEntries(Object.entries(participants.value).reverse())),
      ref([]),
      shared,
      ref(0),
    )
    expect(late.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'e'])
    ranking.value = ['b', 'a', 'e', 'c', 'd']
    orders.value = { '2': ['a', 'b'], '3': ['a', 'b', 'e'] }
    expect(first.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'b'])
    expect(late.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'b'])
  })
  it('projects self exclusion, screen capacity and personal pins without client history', () => {
    const { participants, deps } = setupLayout()
    const ranking = ref(['self', 'e', 'a', 'b', 'c', 'd'])
    const shared = {
      ...deps,
      sharedStageParticipantIds: ranking,
      sharedStagePresentationOrders: ref({
        '1': ['e'],
        '2': ['a', 'e'],
        '3': ['a', 'b', 'e'],
      }),
    }
    const pins = ref<PinnedTile[]>([])
    const screens = ref(0)
    const layout = useLayout(participants, pins, shared, screens)
    expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'e'])
    screens.value = 1
    expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['e'])
    pins.value = [{ type: 'participant', id: 'd' }]
    expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toContain('d')
    pins.value = []
    screens.value = 0
    expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'e'])
  })
})

it('keeps the retained unpinned camera in its strip slot when a hidden pin reserves a tile', () => {
  const { participants, deps } = setupLayout()
  const ranking = ref(['a', 'b', 'c', 'd', 'e'])
  const orders = ref({ '2': ['a', 'b'], '3': ['a', 'b', 'c'] })
  const pins = ref<PinnedTile[]>([{ type: 'participant', id: 'e' }])
  const shared = {
    ...deps,
    sharedStageParticipantIds: ranking,
    sharedStagePresentationOrders: orders,
  }
  const layout = useLayout(participants, pins, shared, ref(0))
  const strip = () =>
    layout.displayParticipants.value.list.filter((p) => p.user_id !== 'e').map((p) => p.user_id)
  expect(strip()).toEqual(['a', 'b'])
  ranking.value = ['b', 'c', 'a', 'd', 'e']
  orders.value = { '2': ['c', 'b'], '3': ['a', 'b', 'c'] }
  expect(strip()).toEqual(['c', 'b'])
  const late = useLayout(participants, pins, shared, ref(0))
  expect(
    late.displayParticipants.value.list.filter((p) => p.user_id !== 'e').map((p) => p.user_id),
  ).toEqual(['c', 'b'])
})

it('reserves multiple personal pins separately from screen and self tiles', () => {
  const { participants, deps } = setupLayout()
  participants.value.f = {
    ...participants.value.a,
    user_id: 'f',
    user_name: 'f',
  }
  const pins = ref<PinnedTile[]>([
    { type: 'participant', id: 'd' },
    { type: 'participant', id: 'e' },
    { type: 'participant', id: 'self' },
  ])
  const screens = ref(0)
  const layout = useLayout(
    participants,
    pins,
    {
      ...deps,
      sharedStageParticipantIds: ref(['self', 'a', 'b', 'c', 'd', 'e']),
      sharedStagePresentationOrders: ref({
        '1': ['a'],
        '2': ['b', 'a'],
        '3': ['c', 'b', 'a'],
      }),
    },
    screens,
  )
  expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['b', 'a', 'd', 'e'])
  screens.value = 1
  expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'd', 'e'])
  pins.value = [
    { type: 'participant', id: 'a' },
    { type: 'participant', id: 'e' },
  ]
  expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['b', 'a', 'e'])
  screens.value = 2
  expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'e'])
})

it('keeps strip slots when a personal pin crosses the canonical prefix', () => {
  const { participants, deps } = setupLayout()
  const ranking = ref(['a', 'b', 'c', 'd', 'e'])
  const orders = ref<Record<string, string[]>>({ '2': ['a', 'b'], '3': ['a', 'b', 'c'] })
  const layout = useLayout(
    participants,
    ref([{ type: 'participant', id: 'a' }]),
    {
      ...deps,
      sharedStageParticipantIds: ranking,
      sharedStagePresentationOrders: orders,
    },
    ref(0),
  )
  const strip = () =>
    layout.displayParticipants.value.list.filter((p) => p.user_id !== 'a').map((p) => p.user_id)
  expect(strip()).toEqual(['b', 'c'])
  ranking.value = ['b', 'c', 'd', 'e', 'a']
  orders.value = { '2': ['c', 'b'], '3': ['d', 'b', 'c'] }
  expect(strip()).toEqual(['b', 'c'])
  ranking.value = ['d', 'c', 'a', 'b', 'e']
  orders.value = { '2': ['c', 'd'], '3': ['d', 'a', 'c'] }
  expect(strip()).toEqual(['d', 'c'])
})

it('preserves personal strip slots through speech, hands, cameras, joins and departures', () => {
  const { participants, deps } = setupLayout()
  const pins = ref<PinnedTile[]>([{ type: 'participant', id: 'e' }])
  const layout = useLayout(participants, pins, deps, ref(0))
  const strip = () =>
    layout.allParticipants.value
      .filter((p) => p.isVisible && p.user_id !== 'e')
      .map((p) => [p.user_id, p.slotIndex])
  expect(strip()).toEqual([
    ['a', 0],
    ['b', 1],
  ])
  deps.activeSpeakerIds.value = ['d']
  expect(strip()).toEqual([
    ['a', 0],
    ['d', 1],
  ])
  deps.stableSpeakerIds.value = ['d']
  deps.activeSpeakerIds.value = []
  expect(strip()).toEqual([
    ['a', 0],
    ['d', 1],
  ])
  deps.raisedHands.value = { c: '2026-10-01T10:00:00Z' }
  expect(strip()).toEqual([
    ['c', 0],
    ['d', 1],
  ])
  participants.value.d.video_enabled = false
  expect(strip()).toEqual([
    ['c', 0],
    ['d', 1],
  ])
  participants.value.f = { ...participants.value.a, user_id: 'f' }
  expect(strip()).toEqual([
    ['c', 0],
    ['d', 1],
  ])
  delete participants.value.d
  expect(strip()).toEqual([
    ['c', 0],
    ['a', 1],
  ])
  delete participants.value.b
  delete participants.value.f
  expect(strip()).toEqual([
    ['c', 0],
    ['a', 1],
  ])
  delete participants.value.c
  expect(strip()).toEqual([['a', 1]])
  expect(layout.vacantStripSlots.value).toEqual([0])
  participants.value.g = { ...participants.value.a, user_id: 'g' }
  expect(strip()).toEqual([
    ['g', 0],
    ['a', 1],
  ])
})

it('keeps multiple pins in pin order and resets personal slots on explicit layout changes', () => {
  const { participants, deps } = setupLayout()
  const pins = ref<PinnedTile[]>([
    { type: 'participant', id: 'e' },
    { type: 'participant', id: 'a' },
  ])
  const ranking = ref(['a', 'b', 'c', 'd', 'e'])
  const screens = ref(0)
  const layout = useLayout(
    participants,
    pins,
    { ...deps, sharedStageParticipantIds: ranking },
    screens,
    { localTileCount: 0 },
  )
  const ids = () => layout.displayParticipants.value.list.map((p) => p.user_id)
  expect(ids()).toEqual(['b', 'c', 'd', 'e', 'a'])
  ranking.value = ['d', 'c', 'b', 'e', 'a']
  expect(ids()).toEqual(['b', 'c', 'd', 'e', 'a'])
  screens.value = 2
  expect(ids()).toEqual(['d', 'e', 'a'])
  pins.value = []
  expect(ids()).toEqual(['d'])
  screens.value = 0
  expect(ids()).toEqual(['d', 'c', 'b'])
})

it('keeps a small pinned call one column with bounded growth', () => {
  viewport.sidebarColumns = 2
  try {
    const { participants, deps } = setupLayout()
    delete participants.value.b
    delete participants.value.c
    delete participants.value.d
    const pins = ref<PinnedTile[]>([{ type: 'participant', id: 'e' }])
    const layout = useLayout(participants, pins, deps, ref(0))
    expect(layout.gridColumns.value).toBe(1)
    for (const id of ['b', 'c', 'd', 'f', 'g'])
      participants.value[id] = { ...participants.value.a, user_id: id }
    expect(layout.gridColumns.value).toBe(1)
    expect(layout.displayParticipants.value.list.map((p) => p.user_id)).toEqual(['a', 'b', 'e'])
    expect(layout.displayParticipants.value.extra).toBe(4)
    expect(layout.overflowSlotIndex.value).toBe(2)
    pins.value = [{ type: 'participant', id: 'a' }]
    expect(layout.gridColumns.value).toBe(2)
    expect(layout.displayParticipants.value.extra).toBe(0)
  } finally {
    viewport.sidebarColumns = 1
  }
})

it('leaves a screen-pinned strip vacancy when a participant departs without replacement', () => {
  const { participants, deps } = setupLayout()
  delete participants.value.c
  delete participants.value.d
  delete participants.value.e
  const layout = useLayout(
    participants,
    ref<PinnedTile[]>([{ type: 'screenshare', id: 'screen' }]),
    deps,
    ref(0),
  )
  expect(layout.allParticipants.value.map((p) => [p.user_id, p.slotIndex])).toEqual([
    ['a', 0],
    ['b', 1],
  ])
  delete participants.value.a
  expect(layout.allParticipants.value.map((p) => [p.user_id, p.slotIndex])).toEqual([['b', 1]])
  expect(layout.vacantStripSlots.value).toEqual([0])
})

it('uses a vacated strip slot for overflow when a join crosses capacity', () => {
  const { participants, deps } = setupLayout()
  delete participants.value.d
  const layout = useLayout(
    participants,
    ref<PinnedTile[]>([{ type: 'participant', id: 'e' }]),
    deps,
    ref(0),
  )
  const strip = () =>
    layout.allParticipants.value
      .filter((p) => p.isVisible && p.user_id !== 'e')
      .map((p) => [p.user_id, p.slotIndex])
  expect(strip()).toEqual([
    ['a', 0],
    ['b', 1],
    ['c', 2],
  ])
  expect(layout.displayParticipants.value.extra).toBe(0)
  participants.value.d = { ...participants.value.a, user_id: 'd' }
  expect(strip()).toEqual([
    ['a', 0],
    ['b', 1],
  ])
  expect(layout.overflowSlotIndex.value).toBe(2)
  expect(layout.vacantStripSlots.value).toEqual([])
  expect(layout.visibleTileCount.value).toBe(5)
  deps.raisedHands.value = { b: '2026-10-01T10:00:00Z' }
  deps.activeSpeakerIds.value = ['d']
  expect(strip()).toEqual([
    ['d', 0],
    ['b', 1],
  ])
  expect(layout.overflowSlotIndex.value).toBe(2)
  delete participants.value.a
  expect(strip()).toEqual([
    ['d', 0],
    ['b', 1],
    ['c', 2],
  ])
  expect(layout.displayParticipants.value.extra).toBe(0)
})

it('retains the same slots regardless of intermediate computed reads', () => {
  const run = (read: boolean) => {
    const { participants, deps } = setupLayout()
    const layout = useLayout(
      participants,
      ref<PinnedTile[]>([{ type: 'participant', id: 'e' }]),
      deps,
      ref(0),
    )
    if (read) void layout.allParticipants.value
    deps.activeSpeakerIds.value = ['d']
    if (read) void layout.overflowSlotIndex.value
    deps.activeSpeakerIds.value = ['c']
    if (read) void layout.vacantStripSlots.value
    return layout.allParticipants.value
      .filter((p) => p.isVisible && p.user_id !== 'e')
      .map((p) => [p.user_id, p.slotIndex])
  }
  expect(run(true)).toEqual([
    ['a', 0],
    ['c', 1],
  ])
  expect(run(false)).toEqual([
    ['a', 0],
    ['c', 1],
  ])
})
