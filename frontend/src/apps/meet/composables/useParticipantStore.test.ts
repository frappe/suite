import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { parseSharedStage } from '../utils/sharedStage'
import { useParticipantStore } from './useParticipantStore'

describe('shared stage delivery', () => {
  it('accepts a late join snapshot and rejects stale, duplicate and reordered delivery', () => {
    setActivePinia(createPinia())
    const store = useParticipantStore()
    const state = {
      epoch: 'room-epoch',
      protocolVersion: 1 as const,
      version: 12,
      participantIds: ['d', 'b', 'a'],
      activeSpeakerIds: ['d'],
    }
    store.applySharedStage(state)
    store.applySharedStage({ ...state, version: 11, participantIds: ['a', 'b', 'd'] })
    store.applySharedStage({ ...state, participantIds: ['b', 'a', 'd'] })
    expect(store.sharedStage?.participantIds).toEqual(['d', 'b', 'a'])
    store.applySharedStage({
      ...state,
      version: 13,
      participantIds: ['b', 'a'],
      activeSpeakerIds: [],
    })
    expect(store.sharedStage?.participantIds).toEqual(['b', 'a'])
    expect(store.activeSpeakerIds).toEqual([])
    store.applySharedStage({ ...state, epoch: 'recreated-room', version: 1 }, true)
    expect(store.sharedStage?.epoch).toBe('recreated-room')
    store.applySharedStage({ ...state, version: 99 })
    expect(store.sharedStage?.epoch).toBe('recreated-room')
  })
  it('rejects malformed canonical state', () => {
    expect(
      parseSharedStage({
        epoch: 'room-epoch',
        protocolVersion: 1,
        version: 1,
        participantIds: ['a', 'a'],
        activeSpeakerIds: [],
      }),
    ).toBeNull()
    expect(
      parseSharedStage({
        epoch: 'room-epoch',
        protocolVersion: 1,
        version: 1,
        participantIds: ['a'],
        activeSpeakerIds: ['b'],
      }),
    ).toBeNull()
  })
})

it('validates and copies presentation permutations without changing older snapshot compatibility', () => {
  const state = {
    epoch: 'room',
    protocolVersion: 1,
    version: 1,
    participantIds: ['c', 'a', 'b'],
    activeSpeakerIds: [],
  }
  expect(parseSharedStage(state)).not.toBeNull()
  const orders = { '2': ['a', 'c'] }
  const parsed = parseSharedStage({ ...state, presentationOrders: orders })
  expect(parsed?.presentationOrders?.[2]).toEqual(['a', 'c'])
  orders[2][0] = 'b'
  expect(parsed?.presentationOrders?.[2]).toEqual(['a', 'c'])
  for (const invalid of [
    { '2': ['a', 'b'] },
    { '2': ['a', 'a'] },
    { '2': ['a'] },
    { '0': [] },
    { '17': ['c', 'a', 'b'] },
  ]) {
    expect(parseSharedStage({ ...state, presentationOrders: invalid })).toBeNull()
  }
})

it('validates the endpoint snapshot after server-owned self exclusion', () => {
  const state = {
    epoch: 'room',
    protocolVersion: 1,
    version: 4,
    participantIds: ['self', 'c', 'a', 'b'],
    activeSpeakerIds: ['self'],
    excludedParticipantId: 'self',
    presentationOrders: { '2': ['a', 'c'] },
  }
  expect(parseSharedStage(state)?.presentationOrders?.[2]).toEqual(['a', 'c'])
  expect(parseSharedStage({ ...state, presentationOrders: { '2': ['self', 'c'] } })).toBeNull()
})
