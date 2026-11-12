import { DRAFTS_DB_NAME, draftsDbName } from '@/apps/slides/utils/slidesCaches'

const DB_VERSION = 1
const STORE = 'presentations'

// set once the shared database is gone, so lookups don't create it again
let legacyDbDeleted = false

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function openDraftsDb(dbName) {
  const request = indexedDB.open(dbName, DB_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
  }

  return requestResult(request)
}

function draftsStore(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

// a newer draft already in the owner's database wins
async function putUnlessNewer(db, record) {
  const lookup = draftsStore(db, 'readonly').get(record.id)
  const storedDraft = await requestResult(lookup)
  if (storedDraft && storedDraft.updatedAt >= record.updatedAt) return

  await requestResult(draftsStore(db, 'readwrite').put(record))
}

async function moveDraftTo(owner, record) {
  const db = await openDraftsDb(draftsDbName(owner))
  const ownedRecord = { ...record, user: owner }
  try {
    await putUnlessNewer(db, ownedRecord)
  } finally {
    db.close()
  }
}

async function adoptDraft(legacyDb, record, previousUser) {
  const owner = record.user || previousUser
  if (!owner) {
    return
  }

  await moveDraftTo(owner, record)
  await requestResult(draftsStore(legacyDb, 'readwrite').delete(record.id))
}

// Drafts in the shared database go to the user who wrote them: the record names
// them, or else they are the user this browser last held data for. Drafts with
// no known owner stay until someone who can edit their presentation opens it
export async function adoptLegacyDrafts(previousUser) {
  const legacyDb = await openDraftsDb(DRAFTS_DB_NAME)
  try {
    const records = await requestResult(draftsStore(legacyDb, 'readonly').getAll())
    for (const record of records) {
      await adoptDraft(legacyDb, record, previousUser)
    }

    const remainingCount = await requestResult(draftsStore(legacyDb, 'readonly').count())
    if (remainingCount) return
  } finally {
    legacyDb.close()
  }

  indexedDB.deleteDatabase(DRAFTS_DB_NAME)
  legacyDbDeleted = true
}

export async function takeUnownedDraft(id, user) {
  if (legacyDbDeleted) {
    return null
  }

  const legacyDb = await openDraftsDb(DRAFTS_DB_NAME)
  try {
    const record = await requestResult(draftsStore(legacyDb, 'readonly').get(id))
    if (!record || record.user) {
      return null
    }

    await moveDraftTo(user, record)
    await requestResult(draftsStore(legacyDb, 'readwrite').delete(id))
    return { ...record, user }
  } finally {
    legacyDb.close()
  }
}

// Old drafts from before every presentation edited in its live room (Q16): a clean one is
// deleted, and a dirty one stays where it is as a recovery copy. The check and the delete
// share one transaction, so a dirty write between them can't be lost. `user` is null for a
// guest, and a draft that names no one is theirs as the editor reads it
export async function settleDrafts(user, id) {
  const db = await openDraftsDb(draftsDbName(user || 'Guest'))
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const kept = []
      // No id opens every draft
      const request = tx.objectStore(STORE).openCursor(id)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return

        settleDraft(cursor, user, kept)
        cursor.continue()
      }

      tx.oncomplete = () => resolve(kept)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

function settleDraft(cursor, user, kept) {
  const draft = cursor.value
  if (!draft.dirty) {
    cursor.delete()
  } else if (!draft.user || draft.user === user) {
    kept.push(draft)
  }
}

// Deletes the draft only while it is still `shown`, by its stamp and its slides. One another
// tab wrote since stays, as the check and the delete share one transaction
export async function deleteDraft(user, shown) {
  const { id, updatedAt, content } = shown
  const db = await openDraftsDb(draftsDbName(user || 'Guest'))
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const request = tx.objectStore(STORE).get(id)
      request.onsuccess = () => {
        const stored = request.result
        if (stored?.updatedAt === updatedAt && JSON.stringify(stored.content) === content) {
          tx.objectStore(STORE).delete(id)
        }
      }

      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
