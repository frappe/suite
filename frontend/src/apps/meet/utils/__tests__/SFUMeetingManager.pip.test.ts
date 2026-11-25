import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SFUMeetingManager } from '../SFUMeetingManager'

function setup() {
  const handlers = new Map<string, (data: unknown) => unknown>()
  const client = {
    on: vi.fn((name, handler) => handlers.set(name, handler)),
    off: vi.fn(),
    isConnected: () => true,
    updateConsumerPreferences: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    getExistingProducers: vi.fn().mockResolvedValue([]),
    getRoomParticipants: vi.fn().mockResolvedValue([]),
    isE2EERequired: () => false,
  }
  const manager = new SFUMeetingManager(fromPartial(client))
  const internal = {
    transportManager: manager['transportManager'],
    consumerManager: manager['consumerManager'],
    connectionManager: manager['connectionManager'],
    mediaManager: manager['mediaManager'],
    participantManager: manager['participantManager'],
  }
  const visibility = vi.spyOn(internal.connectionManager, 'setVisibleCameraParticipants')
  const camera = (participant: string, id = `consumer-${participant}`) => {
    const track = {
      id: `track-${id}`,
      readyState: 'live',
      kind: 'video',
      stop: vi.fn(),
    }
    internal.consumerManager.addConsumer(
      fromPartial({
        id,
        producerId: `producer-${id}`,
        kind: 'video',
        track,
        appData: { userId: participant },
        close: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        once: vi.fn(),
      }),
    )
    return { track, id }
  }
  return { manager, client, internal, visibility, camera, handlers }
}
afterEach(() => vi.restoreAllMocks())
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('SFUMeetingManager PiP camera demand', () => {
  it('keeps selected PiP consumer visible when its main tile is hidden, then restores latest tile demand', async () => {
    const { manager, client, camera } = setup()
    const { id } = camera('alice')
    await manager.updateConsumerStreamPreferences(id, {
      visible: true,
      width: 960,
      height: 540,
    })
    manager.setPictureInPictureParticipant('alice')
    await settle()
    await manager.updateConsumerStreamPreferences(id, {
      visible: false,
      width: 0,
      height: 0,
    })
    expect(client.updateConsumerPreferences).toHaveBeenLastCalledWith({
      consumerId: id,
      visible: true,
      width: 480,
      height: 270,
    })
    manager.setPictureInPictureParticipant(null)
    await settle()
    expect(client.updateConsumerPreferences).toHaveBeenLastCalledWith({
      consumerId: id,
      visible: false,
      width: 0,
      height: 0,
    })
  })
  it('preserves original large tile demand across repeated open and close cycles', async () => {
    const { manager, client, camera } = setup()
    const { id } = camera('alice')
    await manager.updateConsumerStreamPreferences(id, {
      visible: true,
      width: 960,
      height: 540,
    })
    for (let cycle = 0; cycle < 2; cycle++) {
      manager.setPictureInPictureParticipant('alice')
      await settle()
      manager.setPictureInPictureParticipant(null)
      await settle()
      expect(client.updateConsumerPreferences).toHaveBeenLastCalledWith({
        consumerId: id,
        visible: true,
        width: 960,
        height: 540,
      })
    }
  })
  it('switches PiP cameras and releases previous demand without altering source tracks', async () => {
    const { manager, client, camera } = setup()
    const alice = camera('alice')
    const bob = camera('bob')
    manager.setPictureInPictureParticipant('alice')
    await settle()
    client.updateConsumerPreferences.mockClear()
    manager.setPictureInPictureParticipant('bob')
    await settle()
    expect(client.updateConsumerPreferences).toHaveBeenCalledWith({
      consumerId: alice.id,
      visible: false,
      width: 0,
      height: 0,
    })
    expect(client.updateConsumerPreferences).toHaveBeenCalledWith({
      consumerId: bob.id,
      visible: true,
      width: 480,
      height: 270,
    })
    expect(alice.track.stop).not.toHaveBeenCalled()
    expect(bob.track.stop).not.toHaveBeenCalled()
  })
  it('merges PiP participant into subscription visibility and restores latest main visible set on release', async () => {
    const { manager, visibility } = setup()
    await manager.setVisibleRemoteVideoParticipants(['main'])
    manager.setPictureInPictureParticipant('alice')
    await settle()
    expect([...visibility.mock.lastCall![0]]).toEqual(['main', 'alice'])
    await manager.setVisibleRemoteVideoParticipants([])
    expect([...visibility.mock.lastCall![0]]).toEqual(['alice'])
    await manager.setVisibleRemoteVideoParticipants(['other'])
    manager.setPictureInPictureParticipant(null)
    await settle()
    expect([...visibility.mock.lastCall![0]]).toEqual(['other'])
  })
  it('discovers an unsubscribed PiP camera and avoids unsubscribing it when main tiles disappear', async () => {
    const { manager, internal, handlers } = setup()
    const subscribe = vi
      .spyOn(internal.mediaManager, 'subscribeToRemoteProducer')
      .mockResolvedValue(undefined)
    const unsubscribe = vi
      .spyOn(internal.mediaManager, 'unsubscribeFromRemoteProducer')
      .mockResolvedValue(undefined)
    vi.spyOn(internal.connectionManager.expectedMedia, 'waitForHealthy').mockResolvedValue()
    vi.spyOn(internal.transportManager, 'isDeviceLoaded').mockReturnValue(true)
    internal.participantManager.addParticipant({
      participantId: 'alice',
      userData: { name: 'Alice' },
    })
    await internal.connectionManager.connect('token')
    await handlers.get('producer_created')!({
      participantId: 'alice',
      producerId: 'camera-alice',
      kind: 'video',
    })
    expect(subscribe).not.toHaveBeenCalled()
    manager.setPictureInPictureParticipant('alice')
    await manager.setVisibleRemoteVideoParticipants([])
    expect(subscribe).toHaveBeenCalledWith({
      participantId: 'alice',
      producerId: 'camera-alice',
      isScreen: false,
    })
    unsubscribe.mockClear()
    await manager.setVisibleRemoteVideoParticipants([])
    expect(unsubscribe).not.toHaveBeenCalled()
    manager.setPictureInPictureParticipant(null)
    await settle()
    expect(unsubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ producerId: 'camera-alice' }),
    )
  })
  it('refreshes PiP demand after a consumer is replaced for the same participant', async () => {
    const { manager, internal, camera, client } = setup()
    const first = camera('alice')
    manager.setPictureInPictureParticipant('alice')
    await settle()
    internal.consumerManager.removeConsumer(first.id)
    const replacement = camera('alice', 'replacement')
    manager.setPictureInPictureParticipant('alice')
    await settle()
    expect(manager.getRemoteVideoTrack('alice')).toBe(replacement.track)
    expect(client.updateConsumerPreferences).toHaveBeenLastCalledWith({
      consumerId: 'replacement',
      visible: true,
      width: 480,
      height: 270,
    })
  })
  it('clears PiP override on disconnect before a new participant connection', async () => {
    const { manager, internal, visibility, camera, client } = setup()
    const { id } = camera('alice')
    vi.spyOn(internal.connectionManager, 'disconnect').mockResolvedValue()
    await manager.updateConsumerStreamPreferences(id, {
      visible: true,
      width: 960,
      height: 540,
    })
    manager.setPictureInPictureParticipant('alice')
    await settle()
    await manager.disconnect()
    await manager.setVisibleRemoteVideoParticipants(['new-main'])
    expect([...visibility.mock.lastCall![0]]).toEqual(['new-main'])
    client.updateConsumerPreferences.mockClear()
    await manager.updateConsumerStreamPreferences(id, {
      visible: false,
      width: 0,
      height: 0,
    })
    expect(client.updateConsumerPreferences).toHaveBeenLastCalledWith({
      consumerId: id,
      visible: false,
      width: 0,
      height: 0,
    })
  })
})
