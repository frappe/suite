import { DRAFTS_DB_NAME, draftsDbName } from '@/apps/slides/utils/slidesCaches'

const DB_VERSION = 1
const STORE = 'presentations'

// set once the shared database is gone, so lookups don't create it again
let legacyDbDeleted = false

const requestResult = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export const openDraftsDb = (dbName) => {
  const request = indexedDB.open(dbName, DB_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
  }
  return requestResult(request)
}

const draftsStore = (db, mode) => db.transaction(STORE, mode).objectStore(STORE)

// a newer draft already in the owner's database wins
const putUnlessNewer = async (db, record) => {
  const lookup = draftsStore(db, 'readonly').get(record.id)
  const storedDraft = await requestResult(lookup)
  if (storedDraft && storedDraft.updatedAt >= record.updatedAt) return

  await requestResult(draftsStore(db, 'readwrite').put(record))
}

const moveDraftTo = async (owner, record) => {
  const db = await openDraftsDb(draftsDbName(owner))
  const ownedRecord = { ...record, user: owner }
  try {
    await putUnlessNewer(db, ownedRecord)
  } finally {
    db.close()
  }
}

// Drafts in the shared database go to the user who wrote them: the record names
// them, or else they are the user this browser last held data for. Drafts with
// no known owner stay until someone who can edit their presentation opens it
export const adoptLegacyDrafts = async (previousUser) => {
  const legacyDb = await openDraftsDb(DRAFTS_DB_NAME)
  try {
    const records = await requestResult(draftsStore(legacyDb, 'readonly').getAll())
    for (const record of records) {
      const owner = record.user || previousUser
      if (!owner) continue

      await moveDraftTo(owner, record)
      await requestResult(draftsStore(legacyDb, 'readwrite').delete(record.id))
    }
    const remainingCount = await requestResult(draftsStore(legacyDb, 'readonly').count())
    if (remainingCount) return
  } finally {
    legacyDb.close()
  }

  indexedDB.deleteDatabase(DRAFTS_DB_NAME)
  legacyDbDeleted = true
}

export const takeUnownedDraft = async (id, user) => {
  if (legacyDbDeleted) return null

  const legacyDb = await openDraftsDb(DRAFTS_DB_NAME)
  try {
    const record = await requestResult(draftsStore(legacyDb, 'readonly').get(id))
    if (!record || record.user) return null

    await moveDraftTo(user, record)
    await requestResult(draftsStore(legacyDb, 'readwrite').delete(id))
    return { ...record, user }
  } finally {
    legacyDb.close()
  }
}
