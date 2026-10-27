import type { SharedStageState } from '../../../../../suite/meet/types'
import { isUnknownRecord } from '../types'

export type { SharedStageState }
export function parseSharedStage(value: unknown): SharedStageState | null {
  if (!isUnknownRecord(value)) return null
  const state = value
  if (
    Object.keys(state).some(
      (key) =>
        !['epoch', 'protocolVersion', 'version', 'participantIds', 'activeSpeakerIds'].includes(
          key,
        ),
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
  return {
    epoch: state.epoch,
    protocolVersion: 1,
    version: state.version as number,
    participantIds: [...ids],
    activeSpeakerIds: [...active],
  }
}
