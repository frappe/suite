import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TransportError } from '@/platform/transport'

import { createDraftSaver, flushDraftSavers, stopDraftSavers } from './draftSaver'

vi.stubGlobal('__', (text: string) => text)

const networkDown = () => new TransportError({ type: 'NetworkError', message: 'down', status: 0 })
const serverDown = () => new TransportError({ type: 'ServerError', message: 'boom', status: 502 })
const refused = () =>
  new TransportError({ type: 'ValidationError', message: 'Refused', status: 417 })
const noSuchDraft = () =>
  new TransportError({ type: 'DoesNotExistError', message: 'Not found', status: 404 })

/** A server the test answers by hand, recording what each write carried. */
function setup({ online = true, baseline = true, onServer = true } = {}) {
  const onScreen = { text: 'hello' }
  const writes: { text: string; settle: (error?: unknown) => void }[] = []
  const state = { online }
  const copy = { kept: 0, dropped: 0 }
  const refusals: string[] = []
  const saver = createDraftSaver({
    read: () => onScreen.text,
    canSave: () => onScreen.text !== '',
    write: () =>
      new Promise<void>((resolve, reject) =>
        writes.push({
          text: onScreen.text,
          settle: (error) => (error === undefined ? resolve() : reject(error)),
        }),
      ),
    keepCopy: () => copy.kept++,
    dropCopy: () => copy.dropped++,
    onRefused: (message) => refusals.push(message),
    isOnline: () => state.online,
  })
  if (baseline) saver.baseline(onServer)
  const type = (text: string) => {
    onScreen.text = text
    saver.edited()
  }
  return { saver, writes, type, state, copy, refusals, onScreen }
}

const tick = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  stopDraftSavers()
  vi.useRealTimers()
})

describe('when a draft is written', () => {
  it('waits for a pause in typing, then writes once', async () => {
    const { saver, writes, type } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(1500)
    type('ab')
    await vi.advanceTimersByTimeAsync(1500)
    expect(writes).toHaveLength(0)
    expect(saver.status.value).toBe('saving')
    await vi.advanceTimersByTimeAsync(500)
    expect(writes.map((write) => write.text)).toEqual(['ab'])
  })

  it('says saved only once the write has landed', async () => {
    const { saver, writes, type } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    expect(saver.status.value).toBe('saving')
    writes[0].settle()
    await tick()
    expect(saver.status.value).toBe('saved')
    expect(saver.isDirty.value).toBe(false)
  })

  it('saves text typed while a save was on the wire', async () => {
    const { saver, writes, type } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    type('ab')
    writes[0].settle()
    await tick()
    // Landed, and still behind what is on screen: it must not read as saved.
    expect(saver.status.value).toBe('saving')
    expect(saver.isDirty.value).toBe(true)

    await vi.advanceTimersByTimeAsync(2000)
    expect(writes.map((write) => write.text)).toEqual(['a', 'ab'])
    writes[1].settle()
    await tick()
    expect(saver.status.value).toBe('saved')
  })

  it('never has two writes on the wire', async () => {
    const { saver, writes, type } = setup()
    type('a')
    void saver.saveNow()
    await tick()
    type('ab')
    await vi.advanceTimersByTimeAsync(10_000)
    void saver.saveNow()
    await tick()
    expect(writes).toHaveLength(1)
  })

  it('saveNow carries on until the latest text has landed', async () => {
    const { saver, writes, type } = setup()
    type('a')
    const done = saver.saveNow()
    await tick()
    type('ab')
    writes[0].settle()
    await tick()
    expect(writes[1]?.text).toBe('ab')
    writes[1].settle()
    expect(await done).toBe(true)
  })

  it('does not create a draft for a composition with nothing in it', async () => {
    const { saver, writes, type } = setup({ onServer: false })
    type('')
    await vi.advanceTimersByTimeAsync(5000)
    expect(writes).toHaveLength(0)
    expect(saver.status.value).toBe('idle')
    expect(saver.hasUnsaved.value).toBe(false)
  })

  it('a fresh composition is not saved until it has been written in', async () => {
    const { saver, writes, type } = setup({ onServer: false })
    expect(saver.status.value).toBe('idle')
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle()
    await tick()
    expect(saver.status.value).toBe('saved')
  })

  it('writes at once what opened ahead of the server', async () => {
    const { saver, writes } = setup({ baseline: false })
    void saver.saveNow()
    await tick()
    expect(writes.map((write) => write.text)).toEqual(['hello'])
  })
})

describe('when saving fails', () => {
  it('keeps a copy and retries with growing gaps until it lands', async () => {
    const { saver, writes, type, copy } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle(serverDown())
    await tick()
    expect(saver.status.value).toBe('failed')
    expect(copy.kept).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(writes).toHaveLength(2)
    writes[1].settle(serverDown())
    await tick()
    await vi.advanceTimersByTimeAsync(3999)
    expect(writes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toHaveLength(3)

    writes[2].settle()
    await tick()
    expect(saver.status.value).toBe('saved')
    expect(saver.failure.value).toBeUndefined()
    expect(copy.dropped).toBe(1)
  })

  it('does not drop the copy while what is on screen is still ahead of what landed', async () => {
    const { saver, writes, type, copy } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle(serverDown())
    await tick()
    await vi.advanceTimersByTimeAsync(2000)
    type('ab')
    writes[1].settle()
    await tick()
    expect(copy.dropped).toBe(0)
    expect(saver.isDirty.value).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    writes[2].settle()
    await tick()
    expect(copy.dropped).toBe(1)
  })

  it('keeps the copy current with every edit while failing', async () => {
    const { writes, type, copy } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle(serverDown())
    await tick()
    const kept = copy.kept
    type('ab')
    type('abc')
    expect(copy.kept).toBe(kept + 2)
  })

  it('says offline, tries nothing, and saves the moment the connection is back', async () => {
    const { saver, writes, type, state } = setup({ online: false })
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    expect(writes).toHaveLength(0)
    expect(saver.failure.value).toEqual({ kind: 'offline' })

    state.online = true
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(writes.map((write) => write.text)).toEqual(['a'])
    writes[0].settle()
    await tick()
    expect(saver.status.value).toBe('saved')
  })

  it('treats an unanswered request as a failure rather than saving forever', async () => {
    const write = vi.fn(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<void>((_, reject) =>
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    )
    const hung = createDraftSaver({
      read: () => 'x',
      canSave: () => true,
      write,
      keepCopy: vi.fn(),
      dropCopy: vi.fn(),
      isOnline: () => true,
    })
    void hung.saveNow()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(hung.status.value).toBe('failed')
    expect(hung.failure.value).toEqual({ kind: 'unavailable' })
  })

  it('waits as long as the server asks on a 429', async () => {
    const { writes, type } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle(
      new TransportError({
        type: 'TooManyRequests',
        message: 'slow down',
        status: 429,
        retryAfterMs: 20_000,
      }),
    )
    await tick()
    await vi.advanceTimersByTimeAsync(19_999)
    expect(writes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toHaveLength(2)
  })

  it('does not hammer a refusal, reports it once, and tries again on an edit', async () => {
    const { saver, writes, type, refusals } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle(refused())
    await tick()
    expect(saver.failure.value).toEqual({ kind: 'refused', message: 'Refused' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(writes).toHaveLength(1)

    type('ab')
    await vi.advanceTimersByTimeAsync(2000)
    writes[1].settle(refused())
    await tick()
    expect(refusals).toEqual(['Refused'])

    type('abc')
    await vi.advanceTimersByTimeAsync(2000)
    writes[2].settle()
    await tick()
    expect(saver.status.value).toBe('saved')
  })

  it('a retry by hand goes at once, even when the browser reports no network', async () => {
    const { saver, writes, type, state } = setup({ online: false })
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    void saver.retry()
    await tick()
    expect(writes).toHaveLength(1)
    state.online = true
    writes[0].settle()
    await tick()
    expect(saver.status.value).toBe('saved')
  })

  it('undoing an edit back to what the server has clears the failure', async () => {
    const { saver, writes, type, copy } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle(serverDown())
    await tick()
    type('hello')
    expect(saver.status.value).toBe('saved')
    expect(copy.dropped).toBe(1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(writes).toHaveLength(1)
  })
})

describe('when the draft is gone from the server', () => {
  const gone = async (context: ReturnType<typeof setup>) => {
    context.type('a')
    await vi.advanceTimersByTimeAsync(2000)
    context.writes[0].settle(noSuchDraft())
    await tick()
  }

  it('stops writing and keeps the text', async () => {
    const context = setup()
    await gone(context)
    expect(context.saver.status.value).toBe('gone')
    expect(context.copy.kept).toBe(1)
    context.type('ab')
    expect(context.copy.kept).toBe(2)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(context.writes).toHaveLength(1)
    expect(await context.saver.saveNow()).toBe(false)
  })

  it('writes everything again when told to start over', async () => {
    const context = setup()
    await gone(context)
    void context.saver.startOver()
    await tick()
    expect(context.writes[1].text).toBe('a')
    context.writes[1].settle()
    await tick()
    expect(context.saver.status.value).toBe('saved')
  })
})

describe('while a send is deciding', () => {
  it('holds saves back, and waits out the one under way', async () => {
    const { saver, writes, type } = setup()
    type('a')
    void saver.saveNow()
    await tick()
    let held = false
    void saver.hold().then(() => (held = true))
    await tick()
    expect(held).toBe(false)
    writes[0].settle()
    await tick()
    expect(held).toBe(true)

    type('ab')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writes).toHaveLength(1)
  })

  it('hold does not reject when the save under way fails', async () => {
    const { saver, writes, type } = setup()
    type('a')
    void saver.saveNow()
    await tick()
    const held = saver.hold()
    writes[0].settle(serverDown())
    await expect(held).resolves.toBeUndefined()
  })

  it('a failed send of unsaved text falls back to saving it', async () => {
    const { saver, writes, type, copy } = setup()
    type('a')
    await saver.hold()
    saver.resume(networkDown())
    expect(saver.status.value).toBe('failed')
    expect(copy.kept).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(writes.map((write) => write.text)).toEqual(['a'])
  })

  it('a failed send of a saved draft does not read as a failed save', async () => {
    const { saver } = setup()
    await saver.hold()
    saver.resume(networkDown())
    expect(saver.status.value).toBe('saved')
  })

  it('a send finding the draft gone says so', async () => {
    const { saver } = setup()
    await saver.hold()
    saver.resume(noSuchDraft())
    expect(saver.status.value).toBe('gone')
  })
})

describe('when the session ends', () => {
  it('lands what it can first', async () => {
    const { writes, type } = setup()
    type('a')
    const flushed = flushDraftSavers()
    await tick()
    writes[0].settle()
    await flushed
    expect(writes).toHaveLength(1)
  })

  it('writes nothing more once stopped', async () => {
    const { writes, type, copy } = setup()
    type('a')
    await vi.advanceTimersByTimeAsync(2000)
    writes[0].settle(serverDown())
    await tick()
    const kept = copy.kept
    stopDraftSavers()
    type('ab')
    await vi.advanceTimersByTimeAsync(120_000)
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(writes).toHaveLength(1)
    expect(copy.kept).toBe(kept)
  })
})
