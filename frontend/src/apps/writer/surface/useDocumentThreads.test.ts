import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

import type { DocumentThread } from '@/apps/drive'

import { useDocumentThreads } from './useDocumentThreads'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) {
    scope.stop()
  }

  vi.useRealTimers()
})

// Drive's thread list, answered by hand so a test decides when each read returns
function driveThreads() {
  const reads: { answer: (names: string[]) => void; fail: () => void }[] = []
  function list() {
    return new Promise<{ threads: DocumentThread[] }>((resolve, reject) => {
      function answer(threadNames: string[]) {
        resolve({ threads: threadNames.map((name) => ({ name }) as DocumentThread) })
      }

      reads.push({ answer, fail: () => reject(new Error('offline')) })
    })
  }

  return { reads, session: { comments: { list } } as never }
}

function openThreads(session: never, seesThreads?: () => boolean) {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useDocumentThreads(session, seesThreads))!
}

function settled() {
  return new Promise((resolve) => setTimeout(resolve))
}

function names(threads: DocumentThread[]) {
  return threads.map((thread) => thread.name)
}

describe('document threads', () => {
  it('asks nothing while the reader may not see the discussion, and reads once they may', async () => {
    const drive = driveThreads()
    const sees = ref(false)
    const { threads, refresh } = openThreads(drive.session, () => sees.value)

    void refresh()
    window.dispatchEvent(new Event('focus'))
    await settled()
    expect(drive.reads).toHaveLength(0)

    sees.value = true
    await vi.waitFor(() => expect(drive.reads).toHaveLength(1))
    drive.reads[0].answer(['open'])
    await settled()
    expect(names(threads.value)).toEqual(['open'])
  })

  it('reads once more when told of a change while a read runs, and only once', async () => {
    const drive = driveThreads()
    const { threads, refresh } = openThreads(drive.session)

    void refresh()
    void refresh()
    drive.reads[0].answer(['before'])
    await vi.waitFor(() => expect(drive.reads).toHaveLength(2))
    drive.reads[1].answer(['before', 'after'])
    await settled()

    expect([names(threads.value), drive.reads.length]).toEqual([['before', 'after'], 2])
  })

  it('keeps the threads shown when a read fails', async () => {
    const drive = driveThreads()
    const { threads, refresh } = openThreads(drive.session)
    drive.reads[0].answer(['kept'])
    await vi.waitFor(() => expect(names(threads.value)).toEqual(['kept']))

    const failed = refresh()
    drive.reads[1].fail()
    await failed

    expect(names(threads.value)).toEqual(['kept'])
  })

  it('stamps the threads with when their read was sent, which a failed read leaves alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
    const drive = driveThreads()
    const { readAt, refresh } = openThreads(drive.session)
    drive.reads[0].fail()
    await settled()
    const afterFirstFailing = readAt.value
    vi.setSystemTime(2000)
    const answered = refresh()
    vi.setSystemTime(5000)
    drive.reads[1].answer([])
    await answered
    const afterAnswer = readAt.value

    vi.setSystemTime(6000)
    const failed = refresh()
    drive.reads[2].fail()
    await failed

    expect([afterFirstFailing, afterAnswer, readAt.value]).toEqual([null, 2000, 2000])
  })

  it('reads again when the window gets focus', async () => {
    const drive = driveThreads()
    openThreads(drive.session)
    drive.reads[0].answer([])
    await settled()

    window.dispatchEvent(new Event('focus'))

    expect(drive.reads).toHaveLength(2)
  })
})
