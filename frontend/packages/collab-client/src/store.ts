import * as Y from 'yjs'

// One tab load's session of a document. `bound` is false for a clientID a tab
// chose itself offline, until the server accepts its claim
export interface StoredSession {
  doc: string
  sid: string
  lineage: string
  cid: number
  bound: boolean
}

// One captured change, kept until the server acknowledges it or it moves to recovery
export interface StoredEntry {
  doc: string
  sid: string
  seq: number
  bytes: Uint8Array
  sha: string
}

// What the server committed, as this device last saw it: enough to reopen the document offline
export interface DeviceCopy {
  lineage: string
  rev: number
  canWrite: boolean
  // The last quarantine the copy was built after; older copies have none
  epoch?: number
  bytes: Uint8Array
}

export interface RecoveryRecord {
  id?: number
  doc: string
  sid: string
  reason: string
  created: number
  entries: StoredEntry[]
}

// Every write starts its transaction before returning, so writes land in call order
export interface DeviceStore {
  sessions(doc: string): Promise<StoredSession[]>
  entries(doc: string, sid: string): Promise<StoredEntry[]>
  // Rejects if another session of the document already holds the clientID
  saveSession(session: StoredSession): Promise<void>
  // Puts the session back too, in case another tab forgot it while this one was idle
  capture(session: StoredSession, entries: StoredEntry[]): Promise<void>
  // Drops entries up to `through` and keeps their bytes in the device copy, in one transaction,
  // unless the copy has moved to another lineage or was rebuilt after a later quarantine
  acknowledge(
    doc: string,
    sid: string,
    through: number,
    bytes: Uint8Array,
    lineage: string,
    epoch: number,
  ): Promise<void>
  // Adds rows up to `rev` to the device copy; a new lineage replaces it
  commit(doc: string, copy: Omit<DeviceCopy, 'bytes'>, bytes: Uint8Array | null): Promise<void>
  copy(doc: string): Promise<DeviceCopy | null>
  // Moves every remaining entry of the session, plus `extra`, to a recovery record and forgets the session
  recover(doc: string, sid: string, reason: string, extra?: StoredEntry[]): Promise<void>
  // Drops the session unless it still holds entries, so another tab's ack can't orphan what its own tab typed since.
  // Resolves whether the session was dropped
  release(doc: string, sid: string): Promise<boolean>
  recovery(doc: string): Promise<RecoveryRecord[]>
  close(): void
}

const DB_VERSION = 1
// The device copy is merged back into one piece once it holds this many
const MAX_PIECES = 64
const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc())

// The device copy's rev and lineage, kept apart from its pieces
type CopyMeta = Omit<DeviceCopy, 'bytes'>

// One stored part of the device copy's bytes
type StoredPiece = { id: number; bytes: Uint8Array }

// Null where the browser keeps no IndexedDB for this page (blocked storage, or opening hangs)
export function openDeviceStore(name: string, timeoutMs = 3000): Promise<DeviceStore | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name, DB_VERSION)
    } catch {
      clearTimeout(timer)
      resolve(null)
      return
    }

    request.onupgradeneeded = () => createStores(request.result)
    request.onsuccess = () => {
      clearTimeout(timer)
      resolve(new IndexedDeviceStore(request.result))
    }
    request.onerror = request.onblocked = () => {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

function createStores(db: IDBDatabase) {
  const bySession: IDBObjectStoreParameters = { keyPath: ['doc', 'sid'] }
  const byEntry: IDBObjectStoreParameters = { keyPath: ['doc', 'sid', 'seq'] }
  const byDoc: IDBObjectStoreParameters = { keyPath: 'doc' }
  const numbered: IDBObjectStoreParameters = {
    keyPath: 'id',
    autoIncrement: true,
  }
  const unique: IDBIndexParameters = { unique: true }

  const sessions = db.createObjectStore('sessions', bySession)
  sessions.createIndex('cid', ['doc', 'cid'], unique)
  db.createObjectStore('entries', byEntry)
  const copies = db.createObjectStore('copies', numbered)
  copies.createIndex('doc', 'doc')
  db.createObjectStore('meta', byDoc)
  const recovery = db.createObjectStore('recovery', numbered)
  recovery.createIndex('doc', 'doc')
}

const sessionRange = (doc: string, sid: string) =>
  IDBKeyRange.bound([doc, sid, 0], [doc, sid, Infinity])
const docRange = (doc: string) => IDBKeyRange.bound([doc, ''], [doc, '￿'])

class IndexedDeviceStore implements DeviceStore {
  constructor(private readonly db: IDBDatabase) {}

  sessions(doc: string) {
    return this.read<StoredSession[]>('sessions', (tx) =>
      tx.objectStore('sessions').getAll(docRange(doc)),
    )
  }

  entries(doc: string, sid: string) {
    return this.read<StoredEntry[]>('entries', (tx) =>
      tx.objectStore('entries').getAll(sessionRange(doc, sid)),
    )
  }

  recovery(doc: string) {
    return this.read<RecoveryRecord[]>('recovery', (tx) =>
      tx.objectStore('recovery').index('doc').getAll(doc),
    )
  }

  async copy(doc: string): Promise<DeviceCopy | null> {
    const tx = this.db.transaction(['meta', 'copies'])
    const metaRequest = tx.objectStore('meta').get(doc)
    const piecesRequest = tx.objectStore('copies').index('doc').getAll(doc)
    const [meta, pieces] = await Promise.all([
      requestResult<CopyMeta | undefined>(metaRequest),
      requestResult<StoredPiece[]>(piecesRequest),
    ])
    if (!meta) return null

    const bytes = pieces.length ? Y.mergeUpdates(pieces.map((piece) => piece.bytes)) : EMPTY_UPDATE
    return {
      lineage: meta.lineage,
      rev: meta.rev,
      canWrite: meta.canWrite,
      epoch: meta.epoch,
      bytes,
    }
  }

  saveSession(session: StoredSession) {
    return this.write(['sessions'], (tx) => tx.objectStore('sessions').put(session))
  }

  capture(session: StoredSession, entries: StoredEntry[]) {
    const putAll = (tx: IDBTransaction) => {
      tx.objectStore('sessions').put(session)
      for (const entry of entries) {
        tx.objectStore('entries').put(entry)
      }
    }
    return this.write(['sessions', 'entries'], putAll)
  }

  acknowledge(
    doc: string,
    sid: string,
    through: number,
    bytes: Uint8Array,
    lineage: string,
    epoch: number,
  ) {
    const moveToCopy = (tx: IDBTransaction) => {
      const acked = IDBKeyRange.bound([doc, sid, 0], [doc, sid, through])
      tx.objectStore('entries').delete(acked)

      const metaRequest = tx.objectStore('meta').get(doc)
      metaRequest.onsuccess = () => {
        const storedMeta = metaRequest.result
        // As in `commit`: a tab from before a quarantine may build on the quarantined change
        const sameCopy = storedMeta?.lineage === lineage && (storedMeta.epoch ?? 0) <= epoch
        if (bytes.byteLength && sameCopy) {
          addPiece(tx, doc, bytes)
        }
      }
    }
    return this.write(['entries', 'meta', 'copies'], moveToCopy)
  }

  commit(doc: string, copy: CopyMeta, bytes: Uint8Array | null) {
    const addToCopy = (tx: IDBTransaction) => {
      const metaStore = tx.objectStore('meta')
      const metaRequest = metaStore.get(doc)
      metaRequest.onsuccess = () => {
        const storedMeta = metaRequest.result
        const sameLineage = storedMeta?.lineage === copy.lineage
        const storedEpoch = storedMeta?.epoch ?? 0
        const newEpoch = copy.epoch ?? 0
        // A tab that has not heard of a quarantine yet may still hold the quarantined change
        if (sameLineage && storedEpoch > newEpoch) return

        const outdated = storedMeta && (!sameLineage || storedEpoch < newEpoch)
        if (outdated) {
          const pieces = tx.objectStore('copies')
          const keys = pieces.index('doc').getAllKeys(doc)
          keys.onsuccess = () => keys.result.forEach((key) => pieces.delete(key))
        }

        metaStore.put({ doc, ...copy })
        if (bytes?.byteLength) {
          addPiece(tx, doc, bytes)
        }
      }
    }
    return this.write(['meta', 'copies'], addToCopy)
  }

  recover(doc: string, sid: string, reason: string, extra: StoredEntry[] = []) {
    const moveToRecovery = (tx: IDBTransaction) => {
      const entries = tx.objectStore('entries')
      const remainingRequest = entries.getAll(sessionRange(doc, sid))
      remainingRequest.onsuccess = () => {
        const stored: StoredEntry[] = remainingRequest.result
        const seen = new Set(stored.map((entry) => entry.seq))
        const unseen = extra.filter((entry) => !seen.has(entry.seq))
        const allEntries = [...stored, ...unseen]
        if (allEntries.length) {
          const record: RecoveryRecord = {
            doc,
            sid,
            reason,
            created: Date.now(),
            entries: allEntries,
          }
          tx.objectStore('recovery').add(record)
        }

        entries.delete(sessionRange(doc, sid))
        tx.objectStore('sessions').delete([doc, sid])
      }
    }
    return this.write(['sessions', 'entries', 'recovery'], moveToRecovery)
  }

  async release(doc: string, sid: string) {
    let dropped = false
    const dropIfEmpty = (tx: IDBTransaction) => {
      const remainingCount = tx.objectStore('entries').count(sessionRange(doc, sid))
      remainingCount.onsuccess = () => {
        dropped = !remainingCount.result
        if (dropped) {
          tx.objectStore('sessions').delete([doc, sid])
        }
      }
    }
    await this.write(['sessions', 'entries'], dropIfEmpty)
    return dropped
  }

  close() {
    this.db.close()
  }

  private async read<T>(store: string, request: (tx: IDBTransaction) => IDBRequest): Promise<T> {
    const tx = this.db.transaction(store)
    return requestResult<T>(request(tx))
  }

  private write(stores: string[], work: (tx: IDBTransaction) => unknown): Promise<void> {
    const options: IDBTransactionOptions = { durability: 'strict' }
    let tx: IDBTransaction
    try {
      tx = this.db.transaction(stores, 'readwrite', options)
      work(tx)
    } catch (error) {
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    })
  }
}

function addPiece(tx: IDBTransaction, doc: string, bytes: Uint8Array) {
  const pieces = tx.objectStore('copies')
  pieces.add({ doc, bytes })
  const countRequest = pieces.index('doc').count(doc)
  countRequest.onsuccess = () => {
    if (countRequest.result <= MAX_PIECES) return

    const allRequest = pieces.index('doc').getAll(doc)
    allRequest.onsuccess = () => {
      const stored: StoredPiece[] = allRequest.result
      for (const piece of stored) {
        pieces.delete(piece.id)
      }
      const merged = {
        doc,
        bytes: Y.mergeUpdates(stored.map((piece) => piece.bytes)),
      }
      pieces.add(merged)
    }
  }
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
