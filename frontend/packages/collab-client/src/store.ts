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
  // Drops entries up to `through` and keeps their bytes in the device copy, in one transaction
  ack(doc: string, sid: string, through: number, bytes: Uint8Array): Promise<void>
  // Adds rows up to `rev` to the device copy; a new lineage replaces it
  commit(doc: string, copy: Omit<DeviceCopy, 'bytes'>, bytes: Uint8Array | null): Promise<void>
  copy(doc: string): Promise<DeviceCopy | null>
  // Moves every remaining entry of the session, plus `extra`, to a recovery record and forgets the session
  recover(doc: string, sid: string, reason: string, extra?: StoredEntry[]): Promise<void>
  forget(doc: string, sid: string): Promise<void>
  recovery(doc: string): Promise<RecoveryRecord[]>
  close(): void
}

const VERSION = 1
// The device copy is merged back into one piece once it holds this many
const MAX_PIECES = 64

// Null where the browser keeps no IndexedDB for this page (blocked storage, or opening hangs)
export function openDeviceStore(name: string, timeoutMs = 3000): Promise<DeviceStore | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name, VERSION)
    } catch {
      clearTimeout(timer)
      return resolve(null)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('sessions', { keyPath: ['doc', 'sid'] }).createIndex('cid', ['doc', 'cid'], { unique: true })
      db.createObjectStore('entries', { keyPath: ['doc', 'sid', 'seq'] })
      db.createObjectStore('copies', { keyPath: 'id', autoIncrement: true }).createIndex('doc', 'doc')
      db.createObjectStore('meta', { keyPath: 'doc' })
      db.createObjectStore('recovery', { keyPath: 'id', autoIncrement: true }).createIndex('doc', 'doc')
    }
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

const sessionRange = (doc: string, sid: string) => IDBKeyRange.bound([doc, sid, 0], [doc, sid, Infinity])
const docRange = (doc: string) => IDBKeyRange.bound([doc, ''], [doc, '￿'])

class IndexedDeviceStore implements DeviceStore {
  constructor(private readonly db: IDBDatabase) {}

  sessions(doc: string) {
    return this.read<StoredSession[]>('sessions', (tx) => tx.objectStore('sessions').getAll(docRange(doc)))
  }

  entries(doc: string, sid: string) {
    return this.read<StoredEntry[]>('entries', (tx) => tx.objectStore('entries').getAll(sessionRange(doc, sid)))
  }

  recovery(doc: string) {
    return this.read<RecoveryRecord[]>('recovery', (tx) => tx.objectStore('recovery').index('doc').getAll(doc))
  }

  async copy(doc: string): Promise<DeviceCopy | null> {
    const tx = this.db.transaction(['meta', 'copies'])
    const [meta, pieces] = await Promise.all([
      done<{ lineage: string; rev: number; canWrite: boolean } | undefined>(tx.objectStore('meta').get(doc)),
      done<{ bytes: Uint8Array }[]>(tx.objectStore('copies').index('doc').getAll(doc)),
    ])
    if (!meta) return null
    const bytes = pieces.length ? Y.mergeUpdates(pieces.map((piece) => piece.bytes)) : new Uint8Array([0, 0])
    return { lineage: meta.lineage, rev: meta.rev, canWrite: meta.canWrite, bytes }
  }

  saveSession(session: StoredSession) {
    return this.write(['sessions'], (tx) => tx.objectStore('sessions').put(session))
  }

  capture(session: StoredSession, entries: StoredEntry[]) {
    return this.write(['sessions', 'entries'], (tx) => {
      tx.objectStore('sessions').put(session)
      for (const entry of entries) tx.objectStore('entries').put(entry)
    })
  }

  ack(doc: string, sid: string, through: number, bytes: Uint8Array) {
    return this.write(['entries', 'copies'], (tx) => {
      tx.objectStore('entries').delete(IDBKeyRange.bound([doc, sid, 0], [doc, sid, through]))
      if (bytes.byteLength) addPiece(tx, doc, bytes)
    })
  }

  commit(doc: string, copy: Omit<DeviceCopy, 'bytes'>, bytes: Uint8Array | null) {
    return this.write(['meta', 'copies'], (tx) => {
      const meta = tx.objectStore('meta')
      meta.get(doc).onsuccess = (event) => {
        const stored = (event.target as IDBRequest).result
        if (stored && stored.lineage !== copy.lineage) {
          const pieces = tx.objectStore('copies')
          pieces.index('doc').getAllKeys(doc).onsuccess = (keys) => {
            for (const key of (keys.target as IDBRequest).result) pieces.delete(key)
          }
        }
        meta.put({ doc, ...copy })
        if (bytes?.byteLength) addPiece(tx, doc, bytes)
      }
    })
  }

  recover(doc: string, sid: string, reason: string, extra: StoredEntry[] = []) {
    return this.write(['sessions', 'entries', 'recovery'], (tx) => {
      const entries = tx.objectStore('entries')
      entries.getAll(sessionRange(doc, sid)).onsuccess = (event) => {
        const stored: StoredEntry[] = (event.target as IDBRequest).result
        const seen = new Set(stored.map((entry) => entry.seq))
        const all = [...stored, ...extra.filter((entry) => !seen.has(entry.seq))]
        if (all.length) tx.objectStore('recovery').add({ doc, sid, reason, created: Date.now(), entries: all })
        entries.delete(sessionRange(doc, sid))
        tx.objectStore('sessions').delete([doc, sid])
      }
    })
  }

  forget(doc: string, sid: string) {
    return this.write(['sessions'], (tx) => tx.objectStore('sessions').delete([doc, sid]))
  }

  close() {
    this.db.close()
  }

  private async read<T>(store: string, request: (tx: IDBTransaction) => IDBRequest): Promise<T> {
    return done<T>(request(this.db.transaction(store)))
  }

  private write(stores: string[], work: (tx: IDBTransaction) => unknown): Promise<void> {
    let tx: IDBTransaction
    try {
      tx = this.db.transaction(stores, 'readwrite', { durability: 'strict' })
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
  pieces.index('doc').count(doc).onsuccess = (event) => {
    if ((event.target as IDBRequest<number>).result <= MAX_PIECES) return
    pieces.index('doc').getAll(doc).onsuccess = (all) => {
      const stored: { id: number; bytes: Uint8Array }[] = (all.target as IDBRequest).result
      for (const piece of stored) pieces.delete(piece.id)
      pieces.add({ doc, bytes: Y.mergeUpdates(stored.map((piece) => piece.bytes)) })
    }
  }
}

function done<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
