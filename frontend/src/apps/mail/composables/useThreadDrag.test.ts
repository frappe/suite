import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useThreadDrag } from './useThreadDrag'

// The composable is a single shared drag (one cursor, one gesture), so each test starts from rest.
const drag = useThreadDrag()
beforeEach(() => drag.end())

describe('useThreadDrag', () => {
	it('carries the threads and the folders they are already in', () => {
		drag.start(['t1', 't2'], ['mb-inbox'])

		expect(drag.isDragging.value).toBe(true)
		expect(drag.threadIds.value).toEqual(['t1', 't2'])
		expect(drag.filedIn.value).toEqual(['mb-inbox'])
	})

	it('forgets both when the drag ends without landing', () => {
		drag.start(['t1'], ['mb-inbox'])
		drag.end()

		expect(drag.isDragging.value).toBe(false)
		expect(drag.filedIn.value).toEqual([])
	})

	it('moves the dragged threads into the folder they were dropped on', () => {
		const move = vi.fn()
		drag.setMoveHandler(move)
		drag.start(['t1', 't2'], ['mb-inbox'])
		drag.drop('mb-archive')

		expect(move).toHaveBeenCalledWith({ 'mb-archive': ['t1', 't2'] })
		// A drop is also the end of the gesture: nothing is left for the next one to pick up.
		expect(drag.threadIds.value).toEqual([])
		expect(drag.filedIn.value).toEqual([])
		drag.setMoveHandler(null)
	})

	it('moves nothing when a drop lands with no drag in progress', () => {
		const move = vi.fn()
		drag.setMoveHandler(move)
		drag.drop('mb-archive')

		expect(move).not.toHaveBeenCalled()
		drag.setMoveHandler(null)
	})
})
