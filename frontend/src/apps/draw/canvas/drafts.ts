/** Independent editor drafts, with conditional removal of acknowledged recovery. */
import type { Scene } from './selection'

export interface DrawingDraft {
  content: Scene
  baseModified?: string
  title?: string
  revision?: string
  updatedAt?: number
}
export interface DraftEntry {
  key: string
  value: DrawingDraft
}

let database: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('draw-next-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      database = undefined
      reject(request.error)
    }
  })
  return database
}

export async function readDrafts(prefix: string): Promise<DraftEntry[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts')
    const store = transaction.objectStore('drafts')
    const request = store.getAllKeys()
    const entries: DraftEntry[] = []
    request.onsuccess = () => {
      for (const key of request.result) {
        if (typeof key !== 'string' || (key !== prefix && !key.startsWith(`${prefix}:`))) continue
        const item = store.get(key)
        item.onsuccess = () => {
          if (item.result) entries.push({ key, value: item.result })
        }
      }
    }
    transaction.oncomplete = () =>
      resolve(entries.sort((a, b) => (b.value.updatedAt ?? 0) - (a.value.updatedAt ?? 0)))
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function writeDraft(key: string, value: DrawingDraft): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite')
    transaction.objectStore('drafts').put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function removeDraft(entry: DraftEntry): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite')
    const store = transaction.objectStore('drafts')
    const request = store.get(entry.key)
    request.onsuccess = () => {
      const current: DrawingDraft | undefined = request.result
      const matches = entry.value.revision
        ? current?.revision === entry.value.revision
        : JSON.stringify(current) === JSON.stringify(entry.value)
      if (matches) store.delete(entry.key)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
