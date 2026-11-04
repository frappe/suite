import type { SharedStageState } from '../../../../../suite/meet/types'
import { isUnknownRecord } from '../types'

export type { SharedStageState }
export function parseSharedStage(value: unknown): SharedStageState | null {
  if (!isUnknownRecord(value)) return null
  const state = value
  if (
    Object.keys(state).some(
      (key) =>
        ![
          'epoch',
          'protocolVersion',
          'version',
          'participantIds',
          'activeSpeakerIds',
          'presentationOrders',
          'excludedParticipantId',
        ].includes(key),
    )
  )
    return null
  if (
    typeof state.epoch !== 'string' ||
    !state.epoch ||
    state.protocolVersion !== 1 ||
    !Number.isSafeInteger(state.version) ||
    (state.version as number) < 0 ||
    !Array.isArray(state.participantIds) ||
    !Array.isArray(state.activeSpeakerIds)
  )
    return null
  const ids = state.participantIds,
    active = state.activeSpeakerIds
  if (
    !ids.every((id): id is string => typeof id === 'string' && id.length > 0) ||
    !active.every((id): id is string => typeof id === 'string' && ids.includes(id)) ||
    new Set(ids).size !== ids.length ||
    new Set(active).size !== active.length
  )
    return null
  if (state.excludedParticipantId !== undefined && typeof state.excludedParticipantId !== 'string')
    return null
  const selectionIds = ids.filter((id) => id !== state.excludedParticipantId)
  let presentationOrders: Record<string, string[]> | undefined
  if (state.presentationOrders !== undefined) {
    if (!isUnknownRecord(state.presentationOrders)) return null
    presentationOrders = {}
    for (const [capacity, order] of Object.entries(state.presentationOrders)) {
      const count = Number(capacity)
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > 16 ||
        !Array.isArray(order) ||
        order.length !== Math.min(count, selectionIds.length) ||
        !order.every(
          (id): id is string => typeof id === 'string' && selectionIds.slice(0, count).includes(id),
        ) ||
        new Set(order).size !== order.length
      )
        return null
      presentationOrders[capacity] = [...order]
    }
  }
  return {
    ...(typeof state.excludedParticipantId === 'string'
      ? { excludedParticipantId: state.excludedParticipantId }
      : {}),
    ...(presentationOrders ? { presentationOrders } : {}),
    epoch: state.epoch,
    protocolVersion: 1,
    version: state.version as number,
    participantIds: [...ids],
    activeSpeakerIds: [...active],
  }
}
