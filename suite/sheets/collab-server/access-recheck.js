// Access is not decided once (§6.7).
//
// `onAuthenticate` answers "may this socket open" from the grants that existed
// at that moment. A collab session outlives that moment by hours: the grant can
// be revoked, the link behind it can expire, and EDIT can be reduced to READ
// while the tab stays open. So every live connection is re-asked on a fixed
// cadence, and the answer is applied to the connection that is already open.
//
// Three outcomes, and nothing else:
//
//   canRead false     the grant is gone or the link expired. Close the socket.
//   canWrite changed  Drive moved the caller across the EDIT line. Apply it in
//                     place: a downgrade stops the writes, an upgrade releases
//                     them. Both directions, because the answer is Drive's and
//                     holding a stale one open is the same mistake either way.
//   unchanged         do nothing.
//
// This module holds no hocuspocus import and no timer of its own: the clock,
// the check, and both effects are injected. That is what lets `node --test`
// run a week of rechecks in a millisecond, and it keeps the policy readable
// without the transport around it.

// §6.7. One number, and `check_collab_access` returns it in every answer, so a
// site that changes it changes it once. This is the fallback for an answer that
// carries none.
export const DEFAULT_RECHECK_MS = 5 * 60 * 1000

// A recheck that cannot reach Frappe is not an answer. One blip must not drop
// every editor on the site, so a failure leaves the connection exactly as it
// is and the next tick tries again. After this many consecutive failures the
// connection is closed instead: at that point the server has had no confirmed
// answer for three whole periods, and Drive is the only thing allowed to say
// yes (§1).
export const MAX_CONSECUTIVE_FAILURES = 3

export function startAccessRecheck({
	check,
	onRevoke,
	onCapability,
	canWrite = false,
	intervalMs = DEFAULT_RECHECK_MS,
	maxFailures = MAX_CONSECUTIVE_FAILURES,
	timers = globalThis,
}) {
	let stopped = false
	let failures = 0
	let write = Boolean(canWrite)
	// The caller's cadence goes through the same validation an answer's does.
	// Node coerces a negative or non-numeric delay to 1 ms, which turns one
	// connection into ~900 requests a second against an `allow_guest` endpoint.
	const period = periodOf({ recheckSeconds: intervalMs / 1000 }, DEFAULT_RECHECK_MS)
	let handle = timers.setTimeout(tick, period)

	// `unref` keeps a pending recheck from holding the process open at
	// shutdown. Node's timers have it; an injected fake usually does not.
	handle?.unref?.()

	async function tick() {
		if (stopped) return
		let access
		try {
			access = await check()
			failures = 0
		} catch (error) {
			failures += 1
			if (failures >= maxFailures) return finish('unreachable', error)
			return reschedule(period)
		}
		if (stopped) return
		if (!access || !access.canRead) {
			return finish(access?.reason || 'revoked')
		}
		const next = Boolean(access.canWrite)
		if (next !== write) {
			write = next
			// A throw from an injected callback would otherwise reject `tick`,
			// which runs as a bare timer callback: an unhandled rejection, which
			// Node turns into a process exit by default. One connection's
			// transport must not drop every editor on the site, and the loop has
			// to survive to ask again.
			guard(onCapability, { canWrite: next })
		}
		reschedule(periodOf(access, period))
	}

	function reschedule(delay) {
		if (stopped) return
		handle = timers.setTimeout(tick, delay)
		handle?.unref?.()
	}

	function finish(reason, error) {
		if (stopped) return
		stopped = true
		handle = null
		guard(onRevoke, { reason, error })
	}

	// A callback that throws has already failed to apply the answer. Report it
	// and keep the loop's own state consistent; swallowing it silently is not
	// the same as letting it take the process down.
	function guard(callback, argument) {
		if (!callback) return
		try {
			callback(argument)
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error('[collab-server] recheck callback failed', error)
		}
	}

	return {
		stop() {
			if (stopped) return
			stopped = true
			if (handle) timers.clearTimeout(handle)
			handle = null
		},
		get canWrite() {
			return write
		},
		get stopped() {
			return stopped
		},
	}
}

// Frappe states the cadence in every answer so the two never drift. A missing
// or nonsensical value falls back rather than turning into a hot loop.
function periodOf(access, fallback) {
	const seconds = Number(access?.recheckSeconds)
	if (!Number.isFinite(seconds) || seconds <= 0) return fallback
	return seconds * 1000
}
