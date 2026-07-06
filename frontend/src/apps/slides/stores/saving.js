import { ref } from 'vue'
import { presentationId, savePresentationDoc, presentationDoc } from '@/apps/slides/stores/presentation'
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

const markDirty = () => {
	dirty.value = true
}

const markClean = () => {
	dirty.value = false
}

const isSaving = ref(false)

// true when an online save to the server failed; drives the "Not saved" indicator
const saveFailed = ref(false)

const syncSnapshotToServer = async (snapshot) => {
	await savePresentationDoc(snapshot.content)

	// mark local copy clean; baseModified tracks the server version we're now in sync with
	await savePresentationToLocalDB({
		...snapshot,
		dirty: false,
		updatedAt: Date.now(),
		baseModified: presentationDoc.value?.modified,
	})
}

const syncPresentationToServer = async () => {
	const snapshot = await getPresentationFromLocalDB(presentationId.value)
	if (!snapshot || !snapshot.dirty) return

	// throws on failure so the caller keeps the state dirty and retries
	await syncSnapshotToServer(snapshot)
}

const getLatestSlideContent = () => {
	const latestContent = slides.value
	return cloneObj(latestContent)
}

const saveCurrentState = async () => {
	if (isSaving.value) return
	if (!slides.value?.length || !presentationId.value) return

	isSaving.value = true

	try {
		const content = getLatestSlideContent()

		// save to indexedDB as dirty (not yet synced); baseModified = server version these build on
		await savePresentationToLocalDB({
			id: presentationId.value,
			content: content,
			updatedAt: Date.now(),
			dirty: true,
			baseModified: presentationDoc.value?.modified,
		})

		// if offline, stay dirty so we retry once back online
		if (!navigator.onLine) return

		// only mark clean once the server actually has the changes
		await syncPresentationToServer()
		markClean()
		saveFailed.value = false
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
