import { useEventListener } from '@vueuse/core'
import { shallowRef } from 'vue'

import type { DocumentSession, DocumentThread } from '@/apps/drive'

/** A document's comment threads as Drive has them, read again on focus and whenever `refresh` is called. */
export function useDocumentThreads(session: Pick<DocumentSession, 'comments'>) {
  const threads = shallowRef<DocumentThread[]>([])
  const reader = freshReader(async () => {
    threads.value = (await session.comments.list()).threads
  })
  useEventListener(window, 'focus', () => void reader.read())
  void reader.read()
  return { threads, refresh: reader.read }
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
