import { useEventListener } from '@vueuse/core'
import { ref, shallowRef } from 'vue'

import type { DocumentSession, DocumentThread } from '@/apps/drive'

/** A document's comment threads as Drive has them, read again on focus and whenever `refresh` is called. */
export function useDocumentThreads(session: Pick<DocumentSession, 'comments'>) {
  const threads = shallowRef<DocumentThread[]>([])
  /** When the read of the threads shown was sent; null before the first read answers. */
  const readAt = ref<number | null>(null)
  const reader = freshReader(async () => {
    // What answers is at least as new as Drive was when the read was sent
    const sentAt = Date.now()
    threads.value = (await session.comments.list()).threads
    readAt.value = sentAt
  })
  useEventListener(window, 'focus', () => void reader.read())
  void reader.read()
  return { threads, readAt, refresh: reader.read }
}

// Runs `read`, and once more after it when called meanwhile, since that read may predate the change
function freshReader(read: () => Promise<void>) {
  let reading: Promise<void> | null = null
  let isStale = false

  async function readUntilFresh() {
    try {
      do {
        isStale = false
        await read()
      } while (isStale)
    } catch {
      // The threads shown stay until the next read
    }
  }

  return {
    read() {
      if (!reading) {
        reading = readUntilFresh().finally(() => {
          reading = null
        })
      } else {
        isStale = true
      }

      return reading
    },
  }
}
