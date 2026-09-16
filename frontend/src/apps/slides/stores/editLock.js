import { ref } from 'vue'

// another tab of this browser holds the presentation open for editing
const lockedElsewhere = ref(false)

let heldId = null
let releaseHeld = () => {}
let requests = 0

// one request at a time: a second one in the same tick would find this tab's own grant
let lastRequest = Promise.resolve()

const lockName = (id) => `presentation-${id}`

const holdsEditLock = (id) => heldId === id

const releaseEditLock = () => {
	requests++
	heldId = null
	lockedElsewhere.value = false
	releaseHeld()
}

// resolves true once this tab may write; onLost fires if another tab takes the lock over
const acquireEditLock = (id, onLost, { steal = false } = {}) => {
	if (heldId === id) return Promise.resolve(true)
	releaseEditLock()
	if (!navigator.locks) {
		console.warn('Web Locks unavailable: another tab may edit this presentation too')
		heldId = id
		return Promise.resolve(true)
	}
	const request = requests
	const options = steal ? { steal: true } : { ifAvailable: true }
	// the editor moved on to another presentation while this request was pending
	const stale = () => request !== requests
	let resolve
	const answer = new Promise((r) => (resolve = r))

	// runs with the lock; returning releases it
	const hold = (lock) => {
		if (stale()) return resolve(false)
		if (!lock) {
			lockedElsewhere.value = true
			return resolve(false)
		}
		heldId = id
		lockedElsewhere.value = false
		resolve(true)
		return new Promise((done) => (releaseHeld = done))
	}

	const lost = () => {
		if (stale()) return resolve(false)
		// refused before any grant: edit without the lock
		if (heldId !== id) return resolve(true)
		// a granted lock only rejects when another tab steals it
		heldId = null
		onLost?.()
		lockedElsewhere.value = true
	}

	lastRequest = lastRequest
		.then(() => navigator.locks.request(lockName(id), options, hold))
		.catch(lost)
	return answer
}

export { lockedElsewhere, holdsEditLock, acquireEditLock, releaseEditLock }
