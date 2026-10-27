import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { Participant } from '../utils/media/ParticipantManager'
import type { PinnedTile } from './useGridLayout'
import { useLayout } from './useLayout'

vi.mock('./useResponsiveGrid', () => ({
  useResponsiveGrid: () => ({
    isMobile: ref(false),
    maxColumns: ref(1),
    sidebarMaxColumns: ref(1),
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
