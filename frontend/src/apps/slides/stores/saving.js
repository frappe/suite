import { ref, computed } from 'vue'
import {
	presentationId,
	savePresentationDoc,
	presentationDoc,
	inReadonlyMode,
} from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { cloneObj } from '@/apps/slides/utils/helpers'
import { DRAFTS_DB_NAME } from '@/apps/slides/utils/slidesCaches'
import { getSessionUser } from '@/boot/session'

const DB_VERSION = 1
const STORE = 'presentations'

let db = null

const openDB = () => {
	if (db) {
		return Promise.resolve(db)
	}

	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DRAFTS_DB_NAME, DB_VERSION)

		req.onupgradeneeded = () => {
			const db = req.result

			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id' })
			}
		}

		req.onsuccess = () => {
			db = req.result
			// another user taking over deletes the database, which waits on this connection
			db.onversionchange = () => {
				db.close()
				db = null
			}
			resolve(db)
		}

		req.onerror = () => {
			reject(req.error)
		}
	})
}

const savePresentationToLocalDB = async (data) => {
	const db = await openDB()

	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite')
		const store = tx.objectStore(STORE)

		const req = store.put(data)
		req.onerror = () => {
			reject(req.error)
		}

		tx.oncomplete = () => {
			resolve()
		}

		tx.onerror = () => {
			reject(tx.error)
		}
	})
}

let persistRequested = false

// a store that refuses the draft must not stop the push
const writeDraft = (record) => {
	if (!persistRequested) {
		persistRequested = true
		navigator.storage?.persist?.().catch(() => {})
	}
	return savePresentationToLocalDB(record).then(() => true, () => false)
}

const getPresentationFromLocalDB = async (id) => {
	if (id === undefined || id === null || id === '') {
		return null
	}

	const db = await openDB()

	return new Promise((resolve, reject) => {
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
}

// explicit dirty flag set by every mutation path
const dirty = ref(false)

const isSaving = ref(false)

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

// the generation each draft holds, so a blocked push does not rewrite it every tick
const draftGenerations = new Map()

const writeSnapshot = async (snapshot) => {
	const generation = generationFor(snapshot.id)
	if (draftGenerations.get(snapshot.id) === generation) return
	if (await writeDraft(snapshot)) draftGenerations.set(snapshot.id, generation)
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

const syncSnapshotToServer = async (snapshot, id, generation) => {
	// the version this save produced, read from its own response: presentationDoc
	// may already point at another presentation by the time it resolves
	const savedModified = await savePresentationDoc(
		snapshot.id,
		snapshot.content,
		snapshot.baseModified,
	)
	const tail = queuedSnapshots.get(id)
	queuedSnapshots.delete(id)

	if (presentationId.value !== id) {
		// the tail was built on what the server just took, so it goes out on that base
		if (tail) {
			const next = { ...tail, baseModified: savedModified }
			await writeDraft(next)
			return syncSnapshotToServer(next, id, generationFor(id))
		}
		// slides.value belongs to another presentation now and can't be read back;
		// the server has this snapshot
		await writeDraft({
			...snapshot,
			dirty: false,
			updatedAt: Date.now(),
			baseModified: savedModified,
		})
		return
	}

	// an edit made mid-save isn't in the snapshot the server just took, so the
	// local copy has to keep it and stay dirty; baseModified tracks the server version
	const editedDuringSave = generationFor(id) !== generation

	await writeDraft({
		...snapshot,
		content: editedDuringSave ? getLatestSlideContent() : snapshot.content,
		dirty: editedDuringSave,
		updatedAt: Date.now(),
		baseModified: savedModified,
	})
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

const saveCurrentState = async () => {
	const snapshot = takeSnapshot()
	if (!snapshot) return

	const idAtSnapshot = snapshot.id
	const generationAtSnapshot = generationFor(idAtSnapshot)

	// written before the gate, so the draft follows the edits while a push is stuck
	await writeSnapshot(snapshot)

	if (isSaving.value) {
		queuedSnapshots.set(idAtSnapshot, snapshot)
		return
	}
	// if offline, stay dirty so we retry once back online
	if (!navigator.onLine) return
	if (snapshot.baseModified === refusedBase.value) return
	if (Date.now() < retryAt) return

	isSaving.value = true

	try {
		// only mark clean once the server actually has the changes,
		// and only if no edit arrived while this save was in flight
		await syncSnapshotToServer(snapshot, idAtSnapshot, generationAtSnapshot)
		clearSaveFailure()

		// dirty belongs to another presentation now, so it isn't ours to clear
		if (presentationId.value !== idAtSnapshot) return
		if (generationFor(idAtSnapshot) === generationAtSnapshot) markClean()
	} catch (err) {
		// kept, the older queued edit would ride out on a later push over the newer ones
		queuedSnapshots.delete(idAtSnapshot)
		// keep dirty so autosave retries; log once per outage
		if (!saveFailed.value) console.error('Save failed: ', err)
		saveFailed.value = true
		if (err?.exc_type === 'TimestampMismatchError') {
			if (presentationId.value !== idAtSnapshot) return
			// the hold turns the editor read-only, so the edits made during the push go in first
			const latest = takeSnapshot()
			if (latest) await writeSnapshot(latest)
			refusedBase.value = snapshot.baseModified
		} else {
			retryDelay = Math.min(retryDelay * 2 || 500, MAX_RETRY_MS)
			retryAt = Date.now() + retryDelay
		}
	} finally {
		isSaving.value = false
	}
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
	isSaving,
	dirty,
	markDirty,
	markClean,
	writeDraft,
	saveFailed,
	clearSaveFailure,
	saveRefused,
	getPresentationFromLocalDB,
}
