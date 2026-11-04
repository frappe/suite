import { clear, createStore, del, entries, set, type UseStore } from 'idb-keyval'

import { driveLinks } from '@/apps/drive/client/links'
import { useSession } from '@/platform/session'

/**
 * Who an upload record belongs to. A signed-in user owns their records. A
 * guest's record also names the share link that reached the folder, because
 * the server binds a guest session to that link.
 */
export interface UploadOwner {
  user: string
  link: string | null
}

/**
 * What the browser keeps of one upload so it can resume after a reload
 * (spec §6.2). The server forgets a session 24 hours after its last chunk
 * (`BINDING_TTL_SECONDS`), so a record untouched for that long is dropped.
 */
export interface UploadRecord {
  upload_id: string
  owner: UploadOwner
  /** `direct` sessions cannot continue; Resume starts them again. */
  mode: 'chunked' | 'direct'
  parent: string
  /** The picked file's own name, for the resume match. */
  name: string
  /** The title the file is created under, after Keep both or Rename. */
  title?: string
  size: number
  lastModified: number
  /** Bytes the server confirmed when the record was written. Resume asks the server again. */
  bytesSent: number
  /** Chromium only: lets Resume read the file again without a picker. */
  handle?: FileSystemFileHandle
  /** A replace session: the file the bytes replace. */
  replaces?: string
  createdAt: number
  /** The last write the server saw. Expiry counts from here, as the server's does. */
  touchedAt: number
}

export const RECORD_LIFETIME_MS = 24 * 60 * 60 * 1000

export interface UploadRecords {
  /**
   * The current owner's live records, oldest first. Expired records and
   * records of another user are deleted on the way. A guest's records for
   * another link stay stored but are not returned.
   */
  load(): Promise<UploadRecord[]>
  /** Stores a record under the current owner. */
  save(record: Omit<UploadRecord, 'owner'>): Promise<void>
  remove(uploadId: string): Promise<void>
  /** Deletes every record in this browser. Sign out calls it. */
  clear(): Promise<void>
}

export interface UploadRecordsOptions {
  now?: () => number
  /** The owner an upload into `parent` has now. */
  owner?: (parent: string) => UploadOwner
}

/** The signed-in user, or the guest and the link that reaches `parent`. */
export function currentOwner(parent: string): UploadOwner {
  const user = useSession().user.value?.id ?? 'Guest'
  return { user, link: user === 'Guest' ? driveLinks.linkFor(parent) : null }
}

export function createUploadRecords(options: UploadRecordsOptions = {}): UploadRecords {
  const now = options.now ?? Date.now
  const owner = options.owner ?? currentOwner
  let store: UseStore | null = null
  const database = () => (store ??= createStore('suite-drive-uploads', 'records'))
  const available = () => typeof indexedDB !== 'undefined'

  return {
    async load() {
      if (!available()) return []
      const live: UploadRecord[] = []
      for (const [key, record] of await entries<string, Partial<UploadRecord>>(database())) {
        const expired = now() - (record.touchedAt ?? 0) >= RECORD_LIFETIME_MS
        const current = record.parent ? owner(record.parent) : null
        const foreign = !current || record.owner?.user !== current.user
        if (expired || foreign) {
          await del(key, database())
          continue
        }
        if (record.owner?.link !== current.link) continue
        live.push(record as UploadRecord)
      }
      return live.sort((a, b) => a.createdAt - b.createdAt)
    },
    async save(record) {
      if (!available()) return
      const owned: UploadRecord = { ...record, owner: owner(record.parent) }
      try {
        await set(record.upload_id, owned, database())
      } catch {
        // A handle that cannot be cloned still leaves a record that resumes through the picker.
        const { handle: _handle, ...plain } = owned
        await set(record.upload_id, plain, database())
      }
    },
    async remove(uploadId) {
      if (!available()) return
      await del(uploadId, database())
    },
    async clear() {
      if (!available()) return
      await clear(database())
    },
  }
}
