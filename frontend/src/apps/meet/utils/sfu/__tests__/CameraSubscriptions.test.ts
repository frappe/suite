import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsumerManager } from '../../media/ConsumerManager'
import { VideoElementManager } from '../../media/VideoElementManager'
import { SFUMediaManager } from '../SFUMediaManager'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const serverConsumers = new Map<string, string>()
  const consumers = new ConsumerManager()
  let sequence = 0
  let visible = new Set(['a', 'b'])
  const createConsumer = vi.fn(async (producerId: string, metadata: { isScreen?: boolean }) => {
    const id = `consumer-${++sequence}`
    serverConsumers.set(id, producerId)
    return {
      id,
      producerId,
      kind: producerId.startsWith('audio') ? 'audio' : 'video',
      appData: { type: metadata.isScreen ? 'screen' : 'camera' },
      track: {
        id: `track-${id}`,
        kind: 'video',
        readyState: 'live',
        stop: vi.fn(),
      },
      closed: false,
      close: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      once: vi.fn(),
    }
  })
  const closeConsumer = vi.fn(async (id: string) => {
    serverConsumers.delete(id)
  })
  const videoManager = new VideoElementManager()
  const element = document.createElement('video')
  element.play = vi.fn().mockResolvedValue(undefined)
  videoManager.registerVideoElement('a', element)
  const manager = new SFUMediaManager(
    {
      transportManager: { createConsumer, sfuClient: { closeConsumer } },
      consumerManager: consumers,
      videoManager,
      participantManager: { hasParticipant: () => true, getParticipant: () => undefined },
    } as never,
    () => 'self',
  )
  manager.setRemoteSubscriptionPolicy(
    (request) =>
      request.isScreen ||
      request.producerId.startsWith('audio') ||
      visible.has(request.participantId),
  )
  const camera = (id: string) => ({
    producerId: `camera-${id}`,
    participantId: id,
    isScreen: false,
  })
  const demand = async (...ids: string[]) => {
    visible = new Set(ids)
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        visible.has(id)
          ? manager.subscribeToRemoteProducer(camera(id))
          : manager.unsubscribeFromRemoteProducer(camera(id)),
      ),
    )
  }
  return {
    manager,
    element,
    consumers,
    serverConsumers,
    createConsumer,
    closeConsumer,
    camera,
    demand,
  }
}

describe('camera demand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'MediaStream',
      class {
        id = Math.random().toString()
        constructor(private tracks: MediaStreamTrack[] = []) {}
        getTracks() {
          return this.tracks
        }
        getVideoTracks() {
          return this.tracks.filter((t) => t.kind === 'video')
        }
        getAudioTracks() {
          return this.tracks.filter((t) => t.kind === 'audio')
        }
      },
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([false, true])(
    'keeps the replacement track after old close completes (same producer: %s)',
    async (sameProducer) => {
      const f = setup()
      await f.demand('a')
      await f.manager.handleNewConsumer(f.consumers.getAllConsumers()[0])
      const gate = deferred()
      f.closeConsumer.mockImplementationOnce(async (id) => {
        await gate.promise
        f.serverConsumers.delete(id)
      })
      const closing = f.manager.unsubscribeFromRemoteProducer(f.camera('a'))
      await Promise.resolve()
      if (sameProducer) {
        await f.manager.cancelPendingSubscriptions()
        f.consumers.clear()
      }
      const replacement = {
        ...f.camera('a'),
        producerId: sameProducer ? 'camera-a' : 'camera-new',
      }
      await f.manager.subscribeToRemoteProducer(replacement)
      const entry = f.consumers.getAllConsumers().at(-1)!
      await f.manager.handleNewConsumer(entry)
      expect((f.element.srcObject as MediaStream).getVideoTracks()).toEqual([entry.track])
      gate.resolve()
      await closing
      expect((f.element.srcObject as MediaStream)?.getVideoTracks()).toEqual([entry.track])
      await f.manager.reattachAfterProducerClosed('a', 'camera-a')
      expect((f.element.srcObject as MediaStream)?.getVideoTracks()).toEqual([entry.track])
    },
  )

  it('does not close a new generation while waiting for a cancelled pending create', async () => {
    const f = setup()
    const gate = deferred()
    const create = f.createConsumer.getMockImplementation()!
    f.createConsumer.mockImplementationOnce(async (...args) => {
      await gate.promise
      return create(...args)
    })
    const old = f.manager.subscribeToRemoteProducer(f.camera('a')).catch(() => undefined)
    const closing = f.manager.unsubscribeFromRemoteProducer(f.camera('a'))
    await f.manager.cancelPendingSubscriptions()
    await f.manager.subscribeToRemoteProducer(f.camera('a'))
    const replacement = f.consumers.getAllConsumers()[0]
    await f.manager.handleNewConsumer(replacement)
    gate.resolve()
    await Promise.all([old, closing])
    expect([...f.serverConsumers.keys()]).toEqual([replacement.id])
    expect(f.consumers.getAllConsumers()).toEqual([replacement])
    expect((f.element.srcObject as MediaStream).getVideoTracks()).toEqual([replacement.track])
  })

  it('creates only selected remote cameras and preserves audio and screens when demand shrinks', async () => {
    const f = setup()
    await f.manager.subscribeToRemoteProducer({
      producerId: 'audio-c',
      participantId: 'c',
      isScreen: false,
    })
    await f.manager.subscribeToRemoteProducer({
      producerId: 'screen-c',
      participantId: 'c',
      isScreen: true,
    })
    await f.manager.subscribeToRemoteProducer(f.camera('c'))
    await f.demand('a', 'b')
    expect([...f.serverConsumers.values()].sort()).toEqual([
      'audio-c',
      'camera-a',
      'camera-b',
      'screen-c',
    ])
    await f.demand('b')
    expect([...f.serverConsumers.values()].sort()).toEqual(['audio-c', 'camera-b', 'screen-c'])
  })

  it('closes a cancelled late creation before recreating a rapidly shown camera', async () => {
    const f = setup()
    const gate = deferred()
    const create = f.createConsumer.getMockImplementation()!
    f.createConsumer.mockImplementationOnce(async (...args) => {
      await gate.promise
      return create(...args)
    })
    const first = f.manager.subscribeToRemoteProducer(f.camera('a')).catch(() => undefined)
    const hidden = f.demand()
    const shown = f.demand('a')
    gate.resolve()
    await Promise.all([first, hidden, shown])
    expect([...f.serverConsumers.values()]).toEqual(['camera-a'])
    expect(f.consumers.getAllConsumers()).toHaveLength(1)
    expect(f.createConsumer).toHaveBeenCalledTimes(2)
    expect(f.closeConsumer).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight close before reopening and deduplicates concurrent requests', async () => {
    const f = setup()
    await f.demand('a')
    const gate = deferred()
    f.closeConsumer.mockImplementationOnce(async (id) => {
      await gate.promise
      f.serverConsumers.delete(id)
    })
    const hidden = f.demand()
    await Promise.resolve()
    const shown = f.demand('a')
    const duplicate = f.manager.subscribeToRemoteProducer(f.camera('a'))
    expect(f.createConsumer).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([hidden, shown, duplicate])
    expect([...f.serverConsumers.values()]).toEqual(['camera-a'])
    expect(f.createConsumer).toHaveBeenCalledTimes(2)
  })

  it('retries transient close failures and finishes with no retry timers', async () => {
    const f = setup()
    await f.demand('a')
    f.closeConsumer.mockRejectedValueOnce(new Error('temporary'))
    const hidden = f.demand()
    await vi.runAllTimersAsync()
    await hidden
    expect(f.closeConsumer).toHaveBeenCalledTimes(2)
    expect(f.serverConsumers.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds failed closes and escalates so an orphan cannot silently keep forwarding', async () => {
    const f = setup()
    await f.demand('a')
    const exhausted = vi.fn()
    f.manager.setEventHandlers({ onRecoveryExhausted: exhausted })
    f.closeConsumer.mockRejectedValue(new Error('unreachable'))
    const hidden = f.demand().catch((error) => error)
    await vi.runAllTimersAsync()
    expect(await hidden).toBeInstanceOf(Error)
    expect(f.closeConsumer).toHaveBeenCalledTimes(3)
    expect(exhausted).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not recover hidden cameras and preserves demand after receive cancellation', async () => {
    const f = setup()
    await f.demand('b')
    await f.manager.cancelPendingSubscriptions()
    await f.manager.handleConsumerLost({
      ...f.camera('a'),
      consumerId: 'lost',
      kind: 'video',
    })
    await vi.runAllTimersAsync()
    await f.manager.subscribeToRemoteProducer(f.camera('a'))
    expect([...f.serverConsumers.values()]).toEqual(['camera-b'])
  })

  it('cancels a hidden producer retry immediately without waiting for its timer', async () => {
    const f = setup()
    f.createConsumer.mockRejectedValueOnce(new Error('temporary'))
    const subscription = f.manager.subscribeToRemoteProducer(f.camera('a')).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    await f.demand()
    await subscription
    expect(vi.getTimerCount()).toBe(0)
    expect(f.createConsumer).toHaveBeenCalledTimes(1)
    await f.demand('a')
    expect([...f.serverConsumers.values()]).toEqual(['camera-a'])
  })

  it('terminal cleanup cancels close retries and prevents late work from reopening', async () => {
    const f = setup()
    await f.demand('a')
    f.closeConsumer.mockRejectedValueOnce(new Error('temporary'))
    const hidden = f.demand()
    await vi.advanceTimersByTimeAsync(0)
    await f.manager.cleanup()
    await hidden
    await vi.runAllTimersAsync()
    expect(vi.getTimerCount()).toBe(0)
    await expect(f.manager.subscribeToRemoteProducer(f.camera('a'))).rejects.toThrow('ended')
    expect(f.createConsumer).toHaveBeenCalledTimes(1)
  })
})

it('never creates a remote Consumer for self even when self is demanded by shared ranking', async () => {
  const f = setup()
  await f.demand('self')
  await f.manager.subscribeToRemoteProducer({
    producerId: 'camera-self',
    participantId: 'self',
    isScreen: false,
  })
  expect(f.createConsumer).not.toHaveBeenCalled()
  await f.manager.cleanup()
})
