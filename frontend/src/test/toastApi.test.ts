import { describe, expect, it } from 'vitest'

// Reaches past the alias on purpose: every other test resolves `frappe-ui` to the stub in
// recorder/frappeUi.ts, which carries no toast at all.
import { toast } from '../../../node_modules/frappe-ui/src/components/Toast/toast'

/**
 * The toast surface mail's and calendar's helpers depend on.
 *
 * They reach into frappe-ui's toast namespace by name, and a bump that drops one of those names
 * — 695aa923e dropped `create`, `remove` and `removeAll` — says nothing at build time: the
 * frontend has no typecheck in CI, and under test the namespace is a stub. It surfaces as a
 * TypeError at the worst possible moment, because `setUndoAction` and `raiseOptimisticToast`
 * clear the toasts BEFORE the request goes out — the row leaves the list, the server is never
 * told, and the mail is back on the next reload.
 */
const METHODS_CALLED = ['success', 'error', 'promise', 'dismiss'] as const

describe('frappe-ui toast', () => {
	it('still has every method the toast helpers call', () => {
		for (const method of METHODS_CALLED)
			expect(typeof (toast as unknown as Record<string, unknown>)[method]).toBe('function')
	})
})
