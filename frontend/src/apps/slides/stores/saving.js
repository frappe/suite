import { computed, ref } from 'vue'

import {
  inReadonlyMode,
  presentationDoc,
  presentationId,
  savePresentationDoc,
  viewOnly,
} from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { openDraftsDb, takeUnownedDraft } from '@/apps/slides/utils/drafts'
import { cloneObj } from '@/apps/slides/utils/helpers'
import { clearVisitedCopies } from '@/apps/slides/utils/serviceWorker'
import { draftsDbName, isOutOfSpace } from '@/apps/slides/utils/slidesCaches'
import { getSessionUser } from '@/boot/session'

const STORE = 'presentations'

let db = null
let dbOwner = null

function draftsOwner() {
  return getSessionUser() || 'Guest'
}

async function openDB() {
  const user = draftsOwner()
  if (db && dbOwner === user) {
    return db
  }

  db?.close()
  db = await openDraftsDb(draftsDbName(user))
  dbOwner = user
  // a database being deleted or upgraded waits on this connection
  db.onversionchange = () => {
    db.close()
    db = null
  }

  return db
}

// `allowed` is asked right before the transaction opens: IndexedDB runs
// read-write transactions on one store in the order they open, so a write that
// is refused here can never land after one that `stopWrites` made
async function changeDraftStore(change, allowed) {
  const db = await openDB()
  if (!allowed()) return false

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    change(tx.objectStore(STORE))

    tx.oncomplete = () => {
      resolve(true)
    }

    tx.onabort = () => {
      reject(tx.error)
    }
  })
}

function savePresentationToLocalDB(data, allowed = () => true) {
  return changeDraftStore((store) => store.put(data), allowed)
}

function deletePresentationFromLocalDB(id, allowed = () => true) {
  return changeDraftStore((store) => store.delete(id), allowed)
}

let persistRequested = false

// Edit access gone: `stopWrites` bumps the presentation's epoch, and every step
// that writes the draft or sends a save checks the epoch it started under. A
// save already under way stops at its next step, and no draft write lands after.
const stopped = new Set()
const epochs = new Map()
// aborts the push of a presentation whose writes stop
const saveAborts = new Map()

const epochFor = (id) => epochs.get(id) ?? 0

const mayWrite = (id, epoch = epochFor(id)) => !stopped.has(id) && epochFor(id) === epoch

const abortFor = (id) => {
  if (!saveAborts.has(id)) saveAborts.set(id, new AbortController())
  return saveAborts.get(id).signal
}

// the newest dirty draft write per presentation; any write waiting on the clear gives
// way to it. A clean one never makes a dirty one give way, as that may hold newer edits
const draftWrites = new Map()

// a store that refuses the draft must not stop the push; answers whether it wrote
const writeDraft = (record, epoch) => {
  if (!persistRequested) {
    persistRequested = true
    navigator.storage?.persist?.().catch(() => {})
  }

  const turn = (draftWrites.get(record.id) ?? 0) + (record.dirty ? 1 : 0)
  draftWrites.set(record.id, turn)

  function write() {
    return savePresentationToLocalDB(record, () => mayWrite(record.id, epoch))
  }

  return write()
    .catch(async (err) => {
      if (!isOutOfSpace(err)) {
        throw err
      }

      // a draft comes before any visited copy
      await clearVisitedCopies().catch(() => {})
      if (draftWrites.get(record.id) !== turn) {
        return false
      }

      return write()
    })
    .catch(() => false)
}

const getPresentationFromLocalDB = async (id) => {
  if (id === undefined || id === null || id === '') {
    return null
  }

  const db = await openDB()

  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)

    const req = store.get(id)

    req.onsuccess = () => {
      const record = req.result
      // a record another user of this browser left is not ours
      if (record?.user && record.user !== getSessionUser()) return resolve(null)
      resolve(record)
    }

    req.onerror = () => {
      reject(req.error)
    }
  })
  if (record || viewOnly.value) {
    return record ?? null
  }

  return takeUnownedDraft(id, draftsOwner()).catch(() => null)
}

// explicit dirty flag set by every mutation path
const dirty = ref(false)

const isSaving = ref(false)

// whose push `isSaving` last followed, as it is shared across presentations
let lastPushed = null
function lastPushWasFor(id) {
  return lastPushed === id
}

// edits the gate turned away; a push landing after the editor left carries them out
const queuedSnapshots = new Map()

// bumped on every markDirty so a save can tell if edits arrived while it was in flight;
// per presentation, since loading one marks it dirty and must not disturb another's save
const dirtyGenerations = new Map()

const generationFor = (id) => dirtyGenerations.get(id) ?? 0

const markDirty = () => {
  dirty.value = true
  const id = presentationId.value
  if (id) dirtyGenerations.set(id, generationFor(id) + 1)
}

const markClean = () => {
  dirty.value = false
}

// counts the ticks per presentation
const latestTicks = new Map()

// the newest tick past its draft write; a snapshot holds every slide, so an older tick
// has nothing that one lacks. Giving way to any newer tick would stall the push when
// every draft write outlasts the autosave interval
const ticksAtGate = new Map()

// the generation each draft holds, so a blocked push does not rewrite it every tick
const draftGenerations = new Map()

const writeSnapshot = async (snapshot, epoch) => {
  const generation = generationFor(snapshot.id)
  if (draftGenerations.get(snapshot.id) === generation) return
  if (await writeDraft(snapshot, epoch)) draftGenerations.set(snapshot.id, generation)
}

// true when an online save to the server failed; drives the "Not saved" indicator
const saveFailed = ref(false)

// the base the server refused; pushing it again fails the same way until a reload
const refusedBase = ref(null)

// a server that keeps turning the push away is asked again later, not on every tick
const MAX_RETRY_MS = 30_000
let retryDelay = 0
let retryAt = 0

const clearSaveFailure = () => {
  saveFailed.value = false
  refusedBase.value = null
  retryDelay = 0
  retryAt = 0
}

const saveRefused = computed(
  () => refusedBase.value != null && refusedBase.value === presentationDoc.value?.modified,
)

// the server holds this record, so if it can't be written an older dirty draft must
// not outlive it; an edit made during the save keeps the draft
async function writeLanded(record, generation, epoch) {
  if (await writeDraft(record, epoch)) {
    return
  }

  const { id } = record
  await deletePresentationFromLocalDB(
    id,
    () => mayWrite(id, epoch) && generationFor(id) === generation,
  ).catch(() => {})
}

// answers false when the writes stopped before the save finished
const syncSnapshotToServer = async (snapshot, id, generation, epoch) => {
  if (!mayWrite(id, epoch)) return false
  // the version this save produced, read from its own response: presentationDoc
  // may already point at another presentation by the time it resolves
  const savedModified = await savePresentationDoc(
    snapshot.id,
    snapshot.content,
    snapshot.baseModified,
    abortFor(id),
  )
  if (!mayWrite(id, epoch)) return false
  const tail = queuedSnapshots.get(id)
  queuedSnapshots.delete(id)

  if (presentationId.value !== id) {
    // the tail was built on what the server just took, so it goes out on that base
    if (tail) {
      const next = { ...tail, baseModified: savedModified }
      await writeDraft(next, epoch)
      return syncSnapshotToServer(next, id, generationFor(id), epoch)
    }

    // slides.value belongs to another presentation now and can't be read back;
    // the server has this snapshot
    await writeLanded(
      {
        ...snapshot,
        dirty: false,
        updatedAt: Date.now(),
        baseModified: savedModified,
      },
      generation,
      epoch,
    )
    return true
  }

  // an edit made mid-save isn't in the snapshot the server just took, so the
  // local copy has to keep it and stay dirty; baseModified tracks the server version
  const editedDuringSave = generationFor(id) !== generation

  await writeLanded(
    {
      ...snapshot,
      content: editedDuringSave ? getLatestSlideContent() : snapshot.content,
      dirty: editedDuringSave,
      updatedAt: Date.now(),
      baseModified: savedModified,
    },
    generation,
    epoch,
  )
  return true
}

const getLatestSlideContent = () => {
  const latestContent = slides.value
  return cloneObj(latestContent)
}

// pushed as held, never read back: another tab shares this record
const takeSnapshot = () => {
  if (inReadonlyMode.value) return null
  if (!slides.value?.length || !presentationId.value) return null

  return {
    id: presentationId.value,
    user: getSessionUser(),
    content: getLatestSlideContent(),
    updatedAt: Date.now(),
    dirty: true,
    baseModified: presentationDoc.value?.modified,
  }
}

// the local copy alone, for when the edits must not go out yet
const saveDraft = async () => {
  const snapshot = takeSnapshot()
  if (snapshot) await writeSnapshot(snapshot)
}

async function holdRefused(snapshot, epoch) {
  // the hold turns the editor read-only, so the edits made during the push go in first
  const latest = takeSnapshot()
  refusedBase.value = snapshot.baseModified
  if (latest) {
    await writeSnapshot(latest, epoch)
  }

  // a tick during that write queued an edit the hold has already kept
  queuedSnapshots.delete(snapshot.id)
}

const saveCurrentState = async () => {
  const snapshot = takeSnapshot()
  if (!snapshot || stopped.has(snapshot.id)) return

  const idAtSnapshot = snapshot.id
  const generationAtSnapshot = generationFor(idAtSnapshot)
  const epoch = epochFor(idAtSnapshot)
  const tick = (latestTicks.get(idAtSnapshot) ?? 0) + 1
  latestTicks.set(idAtSnapshot, tick)

  // written before the gate, so the draft follows the edits while a push is stuck
  await writeSnapshot(snapshot, epoch)
  if (!mayWrite(idAtSnapshot, epoch) || (ticksAtGate.get(idAtSnapshot) ?? 0) > tick) {
    return
  }

  ticksAtGate.set(idAtSnapshot, tick)

  if (isSaving.value) {
    queuedSnapshots.set(idAtSnapshot, snapshot)
    return
  }
  // if offline, stay dirty so we retry once back online
  if (!navigator.onLine) return
  if (snapshot.baseModified === refusedBase.value) return
  if (Date.now() < retryAt) return

  isSaving.value = true
  lastPushed = idAtSnapshot

  try {
    // only mark clean once the server actually has the changes,
    // and only if no edit arrived while this save was in flight
    if (!(await syncSnapshotToServer(snapshot, idAtSnapshot, generationAtSnapshot, epoch))) return
    clearSaveFailure()

    // dirty belongs to another presentation now, so it isn't ours to clear
    if (presentationId.value !== idAtSnapshot) return
    if (generationFor(idAtSnapshot) === generationAtSnapshot) markClean()
  } catch (err) {
    // the writes stopped mid-push: nothing of this save may land, the failure included
    if (!mayWrite(idAtSnapshot, epoch)) return
    // kept, the older queued edit would ride out on a later push over the newer ones
    queuedSnapshots.delete(idAtSnapshot)
    // keep dirty so autosave retries; log once per outage
    if (!saveFailed.value) console.error('Save failed: ', err)

    // its draft stays dirty for its next open; the failure isn't the open presentation's
    if (presentationId.value !== idAtSnapshot) return

    saveFailed.value = true
    if (err?.type === 'TimestampMismatchError') {
      await holdRefused(snapshot, epoch)
    } else {
      retryDelay = Math.min(retryDelay * 2 || 500, MAX_RETRY_MS)
      retryAt = Date.now() + retryDelay
    }
  } finally {
    isSaving.value = false
  }
}

// `keepContent` answers false to leave the draft in place, as the only place its edits live
async function retireDraft(id, keepContent) {
  const local = await getPresentationFromLocalDB(id).catch(() => null)
  if (!local?.dirty || (keepContent && !keepContent(local.content))) {
    return
  }

  // if that write fails the record goes, so it can't replay either way
  await savePresentationToLocalDB({ ...local, dirty: false, retired: true, updatedAt: Date.now() })
    .catch(() => deletePresentationFromLocalDB(id))
    .catch(() => {})
}

// Edit access is gone. No save starts, the one under way is aborted and lands
// nothing, and the draft is retired so it never replays: the edits live on only
// in the explicit recovery copy the surface keeps. The exception is a draft
// `keepContent` found no room for: it stays, and a later load treats it as any other
async function stopWrites(id, keepContent) {
  if (!id) return
  stopped.add(id)
  epochs.set(id, epochFor(id) + 1)
  queuedSnapshots.delete(id)
  draftGenerations.delete(id)
  saveAborts.get(id)?.abort()
  saveAborts.delete(id)
  await retireDraft(id, keepContent)
}

// Edit access is back. The caller reloads from the server; the old epoch stays
// refused, so nothing started before `stopWrites` lands now.
const resumeWrites = (id) => {
  stopped.delete(id)
}

const saveChanges = async () => {
  if (!dirty.value) return
  await saveCurrentState()
}

// asked for by the user or the network coming back, so the backoff does not apply
const saveWithoutDelay = () => {
  retryAt = 0
  return saveChanges()
}

export {
  saveCurrentState,
  saveChanges,
  saveWithoutDelay,
  saveDraft,
  stopWrites,
  retireDraft,
  resumeWrites,
  isSaving,
  lastPushWasFor,
  dirty,
  markDirty,
  markClean,
  writeDraft,
  saveFailed,
  clearSaveFailure,
  saveRefused,
  getPresentationFromLocalDB,
}
