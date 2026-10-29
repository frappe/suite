import { computed, shallowRef, watch, watchEffect, type ComputedRef, type Ref } from 'vue'

import type { Participant } from '../utils/media/ParticipantManager'
import type { PinnedTile } from './useGridLayout'
import { useResponsiveGrid } from './useResponsiveGrid'

interface LayoutDeps {
  raisedHands: Ref<Record<string, string>>
  activeSpeakerIds: Ref<string[]>
  stableSpeakerIds: Ref<string[]>
  sharedStageParticipantIds?: Ref<string[]>
  sharedStagePresentationOrders?: Ref<Record<string, string[]>>
}

interface DisplayParticipantsResult {
  list: Participant[]
  hidden: Participant[]
  extra: number
}

interface LayoutParticipant extends Participant {
  isVisible: boolean
  slotIndex: number
}

interface UseLayoutReturn {
  mode: ComputedRef<'grid' | 'sidebar'>
  gridColumns: ComputedRef<number>
  displayParticipants: ComputedRef<DisplayParticipantsResult>
  allParticipants: ComputedRef<LayoutParticipant[]>
  visibleTileCount: ComputedRef<number>
  vacantStripSlots: ComputedRef<number[]>
  overflowSlotIndex: ComputedRef<number>
  hiddenParticipantsTooltip: ComputedRef<string>
}

interface LayoutOptions {
  localTileCount?: 0 | 1
}

export function useLayout(
  participants: Ref<Record<string, Participant>>,
  pinnedTiles: Ref<PinnedTile[]>,
  layoutDeps: LayoutDeps,
  extraTiles: Ref<number>,
  options: LayoutOptions = {},
): UseLayoutReturn {
  const localTileCount = options.localTileCount ?? 1
  const { isMobile, maxColumns, sidebarMaxColumns } = useResponsiveGrid()

  const mode = computed<'grid' | 'sidebar'>(() =>
    pinnedTiles.value.length > 0 ? 'sidebar' : 'grid',
  )

  const stripParticipants = computed<Record<string, Participant>>(() => {
    return participants.value
  })

  const getPinnedParticipantId = (): string[] =>
    pinnedTiles.value.filter((t) => t.type === 'participant').map((t) => t.id)

  // Pin, viewport and screen changes start a new layout session. Joins do not.
  const sidebarColumns = shallowRef(1)
  watch(
    () =>
      JSON.stringify([
        pinnedTiles.value,
        isMobile.value,
        sidebarMaxColumns.value,
        extraTiles.value,
      ]),
    () => {
      const pinned = new Set(getPinnedParticipantId())
      const count =
        Object.keys(participants.value).filter((id) => !pinned.has(id)).length +
        localTileCount +
        extraTiles.value
      sidebarColumns.value = isMobile.value
        ? 1
        : Math.min(sidebarMaxColumns.value, count > 4 ? 2 : 1)
    },
    { immediate: true, flush: 'sync' },
  )

  const maxVisibleTiles = computed<number>(() => {
    if (mode.value === 'sidebar') {
      if (isMobile.value) return 3
      return sidebarColumns.value * 4
    }
    return maxColumns.value * 4
  })
  // ── Priority ──────────────────────────────────────────────────────────────

  const getPriority = (
    p: Participant,
    activeSpeakerSet: Set<string>,
    stableSpeakerSet: Set<string>,
    raisedHands: Record<string, string>,
  ): number => {
    const isActive = activeSpeakerSet.has(p.user_id)
    const isStable = stableSpeakerSet.has(p.user_id)
    const hasVideo = !!p.video_enabled
    const hasHand = !!raisedHands[p.user_id]
    if (isActive && hasVideo) return 0
    if (isActive) return 1
    if (hasHand) return 2
    if (isStable && hasVideo) return 3
    if (isStable) return 4
    if (hasVideo) return 5
    return 6
  }

  const getRemoteCapacity = (remoteCount: number, pinnedParticipantIds: string[]): number => {
    const overlayRemoteCount = pinnedParticipantIds.length
    const stripRemoteCount = remoteCount - overlayRemoteCount
    const reserved = localTileCount + extraTiles.value
    const total = stripRemoteCount + reserved
    const threshold = maxVisibleTiles.value

    if (total <= threshold) return remoteCount

    return Math.min(
      remoteCount,
      Math.max(overlayRemoteCount, threshold - reserved - 1 + overlayRemoteCount),
    )
  }

  const buildPriorityMap = (
    remotes: Participant[],
    activeSpeakerSet: Set<string>,
    stableSpeakerSet: Set<string>,
    raisedHands: Record<string, string>,
  ): Map<string, number> => {
    const priorityMap = new Map<string, number>()
    for (const participant of remotes) {
      priorityMap.set(
        participant.user_id,
        getPriority(participant, activeSpeakerSet, stableSpeakerSet, raisedHands),
      )
    }
    return priorityMap
  }

  const partitionVisibleAndHidden = (
    sortedRemotes: Participant[],
    remoteCapacity: number,
    pinnedParticipantIds: string[],
  ): DisplayParticipantsResult => {
    const pins = new Set(pinnedParticipantIds)
    const pinned = sortedRemotes.filter((p) => pins.has(p.user_id))
    const unpinned = sortedRemotes.filter((p) => !pins.has(p.user_id))
    const stripCapacity = Math.max(0, remoteCapacity - pinned.length)
    return {
      list: [...unpinned.slice(0, stripCapacity), ...pinned],
      hidden: unpinned.slice(stripCapacity),
      extra: Math.max(0, unpinned.length - stripCapacity),
    }
  }

  let personalSlots: (string | undefined)[] = []
  let personalLayoutKey = ''
  let personalOverflowSlot: number | undefined
  const stripSlots = new Map<string, number>()
  let vacancies: number[] = []

  // ── Display participants ──────────────────────────────────────────────────

  const projection = shallowRef<{
    display: DisplayParticipantsResult
    slots: Map<string, number>
    vacancies: number[]
    overflow: number | undefined
  }>()
  watchEffect(
    () => {
      const remotes = Object.values(stripParticipants.value || {})
      const pinnedParticipantIds = [...new Set(getPinnedParticipantId())].filter((id) =>
        remotes.some((p) => p.user_id === id),
      )
      const remoteCapacity = getRemoteCapacity(remotes.length, pinnedParticipantIds)

      const stableSpeakers = layoutDeps.stableSpeakerIds.value || []
      const activeSpeakers = layoutDeps.activeSpeakerIds.value || []
      const activeSpeakerSet = new Set<string>(activeSpeakers)
      const stableSpeakerSet = new Set<string>(stableSpeakers)
      const raisedHands = layoutDeps.raisedHands.value || {}

      const priorityMap = buildPriorityMap(remotes, activeSpeakerSet, stableSpeakerSet, raisedHands)
      const ranking = new Map(
        (layoutDeps.sharedStageParticipantIds?.value ?? []).map((id, index) => [id, index]),
      )
      const sortedRemotes = [...remotes].sort((a, b) => {
        if (ranking.size)
          return (
            (ranking.get(a.user_id) ?? Number.MAX_SAFE_INTEGER) -
              (ranking.get(b.user_id) ?? Number.MAX_SAFE_INTEGER) ||
            (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0)
          )
        return (
          (priorityMap.get(a.user_id) ?? 6) - (priorityMap.get(b.user_id) ?? 6) ||
          (raisedHands[a.user_id] ?? '').localeCompare(raisedHands[b.user_id] ?? '') ||
          (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0)
        )
      })
      const partitioned = partitionVisibleAndHidden(
        sortedRemotes,
        remoteCapacity,
        pinnedParticipantIds,
      )

      // Seed personal layouts from the shared presentation; subsequent selection
      // changes replace vacancies without moving retained strip tiles.
      const pins = new Set(pinnedParticipantIds)
      const strip = partitioned.list.filter((p) => !pins.has(p.user_id))
      const presentationCapacity = strip.length
        ? sortedRemotes.findIndex((p) => p.user_id === strip[strip.length - 1].user_id) + 1
        : 0
      const order = layoutDeps.sharedStagePresentationOrders?.value[presentationCapacity]
      if (order) {
        const positions = new Map(order.map((id, index) => [id, index]))
        partitioned.list.sort(
          (a, b) => (positions.get(a.user_id) ?? Infinity) - (positions.get(b.user_id) ?? Infinity),
        )
      }
      const key = JSON.stringify([pinnedTiles.value, maxVisibleTiles.value, extraTiles.value])
      stripSlots.clear()
      vacancies = []
      if (key !== personalLayoutKey || !pinnedTiles.value.length) {
        personalSlots = []
        personalOverflowSlot = undefined
      }
      personalLayoutKey = key
      if (pinnedTiles.value.length) {
        const selected = partitioned.list.filter((p) => !pins.has(p.user_id))
        const selectedIds = new Set(selected.map((p) => p.user_id))
        personalSlots = personalSlots.map((id) => (id && selectedIds.has(id) ? id : undefined))
        if (!partitioned.extra) personalOverflowSlot = undefined
        for (const participant of selected) {
          if (personalSlots.includes(participant.user_id)) continue
          const vacancy = personalSlots.findIndex(
            (id, index) => id === undefined && index !== personalOverflowSlot,
          )
          if (vacancy < 0) personalSlots.push(participant.user_id)
          else personalSlots[vacancy] = participant.user_id
        }
        if (partitioned.extra && personalOverflowSlot === undefined) {
          const vacancy = personalSlots.indexOf(undefined)
          personalOverflowSlot = vacancy < 0 ? personalSlots.length : vacancy
          if (vacancy < 0) personalSlots.push(undefined)
        }
        while (
          personalSlots.length > 0 &&
          personalSlots[personalSlots.length - 1] === undefined &&
          personalSlots.length - 1 !== personalOverflowSlot
        )
          personalSlots.pop()
        personalSlots.forEach((id, index) => {
          if (id) stripSlots.set(id, index)
          else if (index !== personalOverflowSlot) vacancies.push(index)
        })
        const byId = new Map(selected.map((p) => [p.user_id, p]))
        partitioned.list = [
          ...personalSlots.flatMap((id) => (id ? [byId.get(id)!] : [])),
          ...pinnedParticipantIds.map((id) => participants.value[id]),
        ]
      }
      projection.value = {
        display: partitioned,
        slots: new Map(stripSlots),
        vacancies,
        overflow: personalOverflowSlot,
      }
    },
    { flush: 'sync' },
  )
  const displayParticipants = computed(() => projection.value!.display)

  const vacantStripSlots = computed(() => {
    return projection.value!.vacancies
  })

  const overflowSlotIndex = computed(() => {
    const { list, hidden } = displayParticipants.value
    return projection.value!.overflow ?? list.length + hidden.length
  })

  const visibleTileCount = computed<number>(
    () =>
      localTileCount +
      extraTiles.value +
      displayParticipants.value.list.length +
      vacantStripSlots.value.length +
      (displayParticipants.value.extra > 0 ? 1 : 0),
  )

  const gridColumns = computed<number>(() => {
    if (mode.value === 'sidebar') {
      if (isMobile.value) return 1
      return sidebarColumns.value
    }
    const count = visibleTileCount.value
    if (count <= 0) return 1
    if (isMobile.value && count === 2) return 1
    return Math.min(maxColumns.value, Math.ceil(Math.sqrt(count)))
  })

  const allParticipants = computed<LayoutParticipant[]>(() => {
    const { list, hidden } = displayParticipants.value

    const visible: LayoutParticipant[] = list.map((p, idx) => ({
      ...p,
      isVisible: true,
      slotIndex: projection.value!.slots.get(p.user_id) ?? idx,
    }))

    const invisible: LayoutParticipant[] = hidden.map((p, idx) => ({
      ...p,
      isVisible: false,
      slotIndex: list.length + idx,
    }))

    return [...visible, ...invisible]
  })

  const hiddenParticipantsTooltip = computed<string>(() => {
    const hidden = displayParticipants.value.hidden || []
    if (!hidden.length) return ''
    const names = hidden.map((p) => p.user_name || p.user_id)
    const shown = names.slice(0, 8)
    const remaining = names.length - shown.length
    if (remaining > 0) return `${shown.join(', ')} and ${remaining} more`
    if (shown.length === 1) return shown[0]
    if (shown.length === 2) return `${shown[0]} and ${shown[1]}`
    return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  })

  return {
    mode,
    gridColumns,
    displayParticipants,
    allParticipants,
    visibleTileCount,
    vacantStripSlots,
    overflowSlotIndex,
    hiddenParticipantsTooltip,
  }
}
