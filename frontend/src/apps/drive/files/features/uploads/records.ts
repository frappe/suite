import { createStore, del, entries, set, type UseStore } from 'idb-keyval'

/**
 * What the browser keeps of one upload so it can resume after a reload
 * (spec §6.2). The server forgets the session after 24 hours
 * (`BINDING_TTL_SECONDS`), so a record older than that is dropped.
 */
export interface UploadRecord {
  upload_id: string
  parent: string
  /** The picked file's own name, for the resume match. */
  name: string
  /** The title the file is created under, after Keep both or Rename. */
  title?: string
  size: number
  lastModified: number
  /** Bytes the server confirmed. The next chunk starts here. */
  bytesSent: number
  /** Chromium only: lets Resume read the file again without a picker. */
  handle?: FileSystemFileHandle
  /** A replace session: the file the bytes replace. */
  replaces?: string
  createdAt: number
}

export const RECORD_LIFETIME_MS = 24 * 60 * 60 * 1000

export interface UploadRecords {
  /** Records younger than 24 hours. Older ones are deleted on the way. */
  load(): Promise<UploadRecord[]>
  save(record: UploadRecord): Promise<void>
  remove(uploadId: string): Promise<void>
}

export function createUploadRecords(now: () => number = Date.now): UploadRecords {
  let store: UseStore | null = null
  const database = () => (store ??= createStore('suite-drive-uploads', 'records'))
  const available = () => typeof indexedDB !== 'undefined'

  return {
    async load() {
      if (!available()) return []
      const all = await entries<string, UploadRecord>(database())
      const live: UploadRecord[] = []
      for (const [key, record] of all) {
        if (now() - record.createdAt < RECORD_LIFETIME_MS) live.push(record)
        else await del(key, database())
      }
      return live.sort((a, b) => a.createdAt - b.createdAt)
    },
    async save(record) {
      if (!available()) return
      try {
        await set(record.upload_id, record, database())
      } catch {
        // A handle that cannot be cloned still leaves a record that resumes through the picker.
        const { handle: _handle, ...plain } = record
        await set(record.upload_id, plain, database())
      }
    },
    async remove(uploadId) {
      if (!available()) return
      await del(uploadId, database())
    },
  }
}
