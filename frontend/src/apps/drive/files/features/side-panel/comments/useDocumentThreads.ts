import { useEventListener } from '@vueuse/core'
import { ref, shallowRef, watch } from 'vue'

import type { DocumentSession, DocumentThread } from '@/apps/drive'

// Never longer than a person should be held up
const READ_LIMIT_MS = 10_000

/**
 * A document's comment threads as Drive has them, read again on focus, when `isOpen` turns true
 * and whenever `refresh` is called. No read is sent while `seesThreads` is false: the reader may
 * not see the discussion.
 */
export function useDocumentThreads(
  session: Pick<DocumentSession, 'comments'>,
  seesThreads: () => boolean = () => true,
  isOpen: () => boolean = () => false,
) {
  const threads = shallowRef<DocumentThread[]>([])
  /** When the read of the threads shown was sent; null before the first read answers. */
  const readAt = ref<number | null>(null)
  const reader = freshReader(async () => {
    if (!seesThreads()) {
      threads.value = []
      return
    }
    // What answers is at least as new as Drive was when the read was sent
    const sentAt = Date.now()
    threads.value = (await withinLimit(session.comments.list())).threads
    readAt.value = sentAt
  })
  useEventListener(window, 'focus', () => void reader.read())
  // Seeing the threads and opening them at once is one read
  watch(
    [seesThreads, isOpen],
    ([sees, open], previous) => {
      if (!previous || sees !== previous[0] || (open && !previous[1])) {
        void reader.read()
      }
    },
    { immediate: true },
  )
  return { threads, readAt, refresh: reader.read }
}

// The transport has no limit of its own, and a read that never answers would hold back every later one.
// A read that gives up never writes the threads, however late its answer comes.
function withinLimit<Answer>(read: Promise<Answer>) {
  let timer: ReturnType<typeof setTimeout>
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The threads took too long to read')), READ_LIMIT_MS)
  })
  return Promise.race([read, limit]).finally(() => clearTimeout(timer))
}

// Runs `read`, and once more after it when called meanwhile, since that read may predate the change
function freshReader(read: () => Promise<void>) {
  let reading: Promise<void> | null = null
  let isStale = false

  async function readUntilFresh() {
    do {
      isStale = false
      try {
        await read()
      } catch {
        // The threads shown stay until the next read
      }
    } while (isStale)
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
