import { computed, type ComputedRef, type Ref } from 'vue'

import type { Participant } from '../utils/media/ParticipantManager'
import type { PinnedTile } from './useGridLayout'
import { useResponsiveGrid } from './useResponsiveGrid'

interface LayoutDeps {
  raisedHands: Ref<Record<string, string>>
  activeSpeakerIds: Ref<string[]>
  stableSpeakerIds: Ref<string[]>
  sharedStageParticipantIds?: Ref<string[]>
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

  const maxVisibleTiles = computed<number>(() => {
    if (mode.value === 'sidebar') {
      if (isMobile.value) return 3
      return sidebarMaxColumns.value * 4
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

  const getPinnedParticipantId = (): string[] =>
    pinnedTiles.value.filter((t) => t.type === 'participant').map((t) => t.id)

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

  const ensurePinnedParticipantVisible = (
    visibleRemotes: Participant[],
    remotes: Participant[],
    pinnedParticipantIds: string[],
    remoteCapacity: number,
  ): Participant[] => {
    if (pinnedParticipantIds.length === 0 || remoteCapacity <= 0) return visibleRemotes

    const newVisible = [...visibleRemotes]

    for (const pinnedId of pinnedParticipantIds) {
      const isPinnedVisible = newVisible.some((p) => p.user_id === pinnedId)

      if (!isPinnedVisible) {
        const pinnedParticipant = remotes.find((p) => p.user_id === pinnedId)
        if (pinnedParticipant) {
          if (newVisible.length >= remoteCapacity) {
            newVisible.pop()
          }
          newVisible.unshift(pinnedParticipant)
        }
      }
    }
    return newVisible
  }

  const partitionVisibleAndHidden = (
    sortedRemotes: Participant[],
    remoteCapacity: number,
    remotes: Participant[],
    pinnedParticipantId: string[],
  ): DisplayParticipantsResult => {
    const visibleRemotes = ensurePinnedParticipantVisible(
      sortedRemotes.slice(0, remoteCapacity),
      remotes,
      pinnedParticipantId,
      remoteCapacity,
    )

    const visibleIds = new Set(visibleRemotes.map((participant) => participant.user_id))
    const hidden = sortedRemotes.filter((participant) => !visibleIds.has(participant.user_id))

    return {
      list: visibleRemotes,
      hidden,
      extra: hidden.length,
    }
  }

  // ── Display participants ──────────────────────────────────────────────────

  const displayParticipants = computed<DisplayParticipantsResult>(() => {
    const remotes = Object.values(stripParticipants.value || {})
    const pinnedParticipantIds = getPinnedParticipantId()
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
      remotes,
      pinnedParticipantIds,
    )

    return partitioned
  })

  const visibleTileCount = computed<number>(
    () =>
      localTileCount +
      extraTiles.value +
      displayParticipants.value.list.length +
      (displayParticipants.value.extra > 0 ? 1 : 0),
  )

  const gridColumns = computed<number>(() => {
    if (mode.value === 'sidebar') {
      if (isMobile.value) return 1
      const pinnedParticipantIds = new Set(getPinnedParticipantId())
      const stripTileCount =
        visibleTileCount.value -
        displayParticipants.value.list.filter((participant) =>
          pinnedParticipantIds.has(participant.user_id),
        ).length
      return Math.min(stripTileCount > 4 ? 2 : 1, sidebarMaxColumns.value)
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
      slotIndex: idx,
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
    hiddenParticipantsTooltip,
  }
}
