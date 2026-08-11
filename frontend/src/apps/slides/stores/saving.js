import { ref } from 'vue'
import {
	presentationId,
	savePresentationDoc,
	presentationDoc,
	inReadonlyMode,
} from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { cloneObj } from '@/apps/slides/utils/helpers'

const DB_NAME = 'slides-db'
const DB_VERSION = 1
const STORE = 'presentations'

let db = null

const openDB = () => {
	if (db) {
		return Promise.resolve(db)
	}

	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)

		req.onupgradeneeded = () => {
			const db = req.result

			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id' })
			}
		}

		req.onsuccess = () => {
			db = req.result
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
			resolve(req.result)
		}

		req.onerror = () => {
			reject(req.error)
		}
	})
}

// explicit dirty flag set by every mutation path
const dirty = ref(false)

const isSaving = ref(false)

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
	// a save in flight still has a generation to compare against, so leave it alone
	if (!isSaving.value) dirtyGenerations.delete(presentationId.value)
}

// true when an online save to the server failed; drives the "Not saved" indicator
const saveFailed = ref(false)

const syncSnapshotToServer = async (snapshot, id, generation) => {
	// the resource points at whatever the editor moved on to, so this content
	// would land on the wrong document; the snapshot stays dirty and gets retried
	if (presentationId.value !== id) return

	// the version this save produced, read from its own response: presentationDoc
	// may already point at another presentation by the time it resolves
	const savedModified = await savePresentationDoc(snapshot.content)

	if (presentationId.value !== id) {
		// an edit made mid-save lives in slides.value, which belongs to another
		// presentation now and can't be read back; the server has this snapshot
		await savePresentationToLocalDB({
			...snapshot,
			dirty: false,
			updatedAt: Date.now(),
			baseModified: savedModified,
		})
		dirtyGenerations.delete(id)
		return
	}

	// an edit made mid-save isn't in the snapshot the server just took, so the
	// local copy has to keep it and stay dirty; baseModified tracks the server version
	const editedDuringSave = generationFor(id) !== generation

	await savePresentationToLocalDB({
		...snapshot,
		content: editedDuringSave ? getLatestSlideContent() : snapshot.content,
		dirty: editedDuringSave,
		updatedAt: Date.now(),
		baseModified: savedModified,
	})
}

const syncPresentationToServer = async (id, generation) => {
	const snapshot = await getPresentationFromLocalDB(id)
	if (!snapshot || !snapshot.dirty) return

	// throws on failure so the caller keeps the state dirty and retries
	await syncSnapshotToServer(snapshot, id, generation)
}

const getLatestSlideContent = () => {
	const latestContent = slides.value
	return cloneObj(latestContent)
}

const saveCurrentState = async () => {
	if (inReadonlyMode.value) return
	if (isSaving.value) return
	if (!slides.value?.length || !presentationId.value) return

	isSaving.value = true

	try {
		const idAtSnapshot = presentationId.value
		const generationAtSnapshot = generationFor(idAtSnapshot)
		const content = getLatestSlideContent()

		// save to indexedDB as dirty (not yet synced); baseModified = server version these build on
		await savePresentationToLocalDB({
			id: idAtSnapshot,
			content: content,
			updatedAt: Date.now(),
			dirty: true,
			baseModified: presentationDoc.value?.modified,
		})

		// if offline, stay dirty so we retry once back online
		if (!navigator.onLine) return

		// only mark clean once the server actually has the changes,
		// and only if no edit arrived while this save was in flight
		await syncPresentationToServer(idAtSnapshot, generationAtSnapshot)
		saveFailed.value = false

		// dirty belongs to another presentation now, so it isn't ours to clear
		if (presentationId.value !== idAtSnapshot) return
		if (generationFor(idAtSnapshot) === generationAtSnapshot) markClean()
	} catch (err) {
		// keep dirty so autosave retries and beforeunload warns; log once per outage
		if (!saveFailed.value) console.error('Save failed: ', err)
		saveFailed.value = true
	} finally {
		isSaving.value = false
	}
}

const saveChanges = async () => {
	if (!dirty.value) return
	await saveCurrentState()
}

export {
	saveCurrentState,
	saveChanges,
	isSaving,
	dirty,
	markDirty,
	markClean,
	saveFailed,
	getPresentationFromLocalDB,
}
