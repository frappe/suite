import { DRAFTS_DB_NAME, draftsDbName } from '@/apps/slides/utils/slidesCaches'

const DB_VERSION = 1
const STORE = 'presentations'

// set once the shared database is gone, so lookups don't create it again
let legacyGone = false

const settle = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export const openDrafts = (name) => {
  const req = indexedDB.open(name, DB_VERSION)
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(STORE)) {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
  }
  return settle(req)
}

const store = (db, mode) => db.transaction(STORE, mode).objectStore(STORE)

// a newer draft already in the owner's database wins
const putUnlessNewer = async (db, record) => {
  const held = await settle(store(db, 'readonly').get(record.id))
  if (held && held.updatedAt >= record.updatedAt) return
  await settle(store(db, 'readwrite').put(record))
}

const moveTo = async (owner, record) => {
  const db = await openDrafts(draftsDbName(owner))
  try {
    await putUnlessNewer(db, { ...record, user: owner })
  } finally {
    db.close()
  }
}

// Drafts in the shared database go to the user who wrote them: the record names
// them, or else they are the user this browser last held data for. Drafts with
// no known owner stay until someone who can edit their presentation opens it
export const adoptLegacyDrafts = async (previousUser) => {
  const legacy = await openDrafts(DRAFTS_DB_NAME)
  try {
    for (const record of await settle(store(legacy, 'readonly').getAll())) {
      const owner = record.user || previousUser
      if (!owner) continue
      await moveTo(owner, record)
      await settle(store(legacy, 'readwrite').delete(record.id))
    }
    const left = await settle(store(legacy, 'readonly').count())
    if (left) return
  } finally {
    legacy.close()
  }
  indexedDB.deleteDatabase(DRAFTS_DB_NAME)
  legacyGone = true
}

export const takeUnownedDraft = async (id, user) => {
  if (legacyGone) return null
  const legacy = await openDrafts(DRAFTS_DB_NAME)
  try {
    const record = await settle(store(legacy, 'readonly').get(id))
    if (!record || record.user) return null
    await moveTo(user, record)
    await settle(store(legacy, 'readwrite').delete(id))
    return { ...record, user }
  } finally {
    legacy.close()
  }
}
