import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'

import { claimComposeWindow, restoreComposeWindow } from './useComposeWindow'

// The window is module state shared by every composer, so each test has to leave it empty for the
// next one — the same reason the composable has to release on dispose at all.
const scopes: EffectScope[] = []

/** A composer, mounted open or closed the way SendMail's `show` arrives. */
const composer = (open: boolean, onRestore?: () => void) => {
	const show = ref<boolean | undefined>(open)
	const scope = effectScope()
	scopes.push(scope)
	scope.run(() => claimComposeWindow(show, onRestore))
	return { show, unmount: () => scope.stop() }
}

afterEach(() => {
	while (scopes.length) scopes.pop()!.stop()
})

describe('claimComposeWindow', () => {
	it('claims the window when it mounts already open', () => {
		// DefaultLayout bumps its key and sets `show` in one tick, so the instance is created with
		// the composer already showing; a watcher that only fired on change would miss it.
		composer(true)
		expect(restoreComposeWindow()).toBe(true)
	})

	it('leaves the window alone when it mounts closed', () => {
		composer(false)
		expect(restoreComposeWindow()).toBe(false)
	})

	it('hands the window to the composer that opens last', async () => {
		const first = composer(true)
		const second = composer(true)
		await nextTick()

		expect(first.show.value).toBe(false)
		expect(second.show.value).toBe(true)
	})

	it('releases the window when the composer closes', async () => {
		const only = composer(true)
		only.show.value = false
		await nextTick()

		expect(restoreComposeWindow()).toBe(false)
	})

	it('releases the window when an open composer unmounts', () => {
		// A draft popped out of a thread goes away with the thread. Left holding the window, it
		// would answer Compose forever and open nothing.
		composer(true).unmount()
		expect(restoreComposeWindow()).toBe(false)
	})

	it('does not release a window another composer has since taken', async () => {
		const first = composer(true)
		const second = composer(true)
		await nextTick()
		first.unmount()

		expect(restoreComposeWindow()).toBe(true)
		expect(second.show.value).toBe(true)
	})
})

describe('restoreComposeWindow', () => {
	it('unfolds the composer holding the window', () => {
		const unfold = vi.fn()
		composer(true, unfold)

		expect(restoreComposeWindow()).toBe(true)
		expect(unfold).toHaveBeenCalledOnce()
	})

	it('reports nothing to restore when no composer is open', () => {
		expect(restoreComposeWindow()).toBe(false)
	})

	it('unfolds the newest composer, not the one it replaced', async () => {
		const first = vi.fn()
		const second = vi.fn()
		composer(true, first)
		composer(true, second)
		await nextTick()

		restoreComposeWindow()
		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledOnce()
	})
})
