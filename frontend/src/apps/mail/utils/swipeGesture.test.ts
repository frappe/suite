import { describe, expect, it } from 'vitest'

import { createSwipeGesture } from './swipeGesture'

describe('createSwipeGesture', () => {
	it('pages on a decisively horizontal swipe', () => {
		const gesture = createSwipeGesture()

		gesture.start(280, 400)
		gesture.move(220, 404)
		gesture.move(160, 408)

		expect(gesture.end(150, 410)).toBe(1)
	})

	it('pages the other way on a swipe to the right', () => {
		const gesture = createSwipeGesture()

		gesture.start(100, 400)
		gesture.move(180, 402)

		expect(gesture.end(200, 404)).toBe(-1)
	})

	// The reported bug: scrolling a message paged to the next thread. A scroll wanders
	// back towards the height it began at, so the two endpoints alone say "100px
	// sideways, no vertical drift" — a swipe, by the old rule.
	it('ignores a scroll that ends back at the height it began', () => {
		const gesture = createSwipeGesture()

		gesture.start(200, 400)
		gesture.move(210, 250)
		gesture.move(240, 330)
		gesture.move(262, 396)

		expect(gesture.end(300, 400)).toBeNull()
	})

	it('holds the scroll verdict even when the finger then travels sideways', () => {
		const gesture = createSwipeGesture()

		gesture.start(300, 400)
		gesture.move(300, 300)
		gesture.move(120, 300)

		expect(gesture.end(100, 300)).toBeNull()
	})

	it('lets a swipe through a drift smaller than the scroll lock', () => {
		const gesture = createSwipeGesture()

		gesture.start(300, 400)
		gesture.move(240, 420)
		gesture.move(180, 418)

		expect(gesture.end(170, 416)).toBe(1)
	})

	it('refuses a sideways drag that is too short', () => {
		const gesture = createSwipeGesture()

		gesture.start(200, 400)
		gesture.move(170, 402)

		expect(gesture.end(160, 402)).toBeNull()
	})

	it('refuses a diagonal that never dominates its own vertical travel', () => {
		const gesture = createSwipeGesture()

		gesture.start(300, 400)

		expect(gesture.end(200, 340)).toBeNull()
	})

	it('ignores a two-finger gesture', () => {
		const gesture = createSwipeGesture()

		gesture.start(200, 400, 2)

		expect(gesture.end(100, 400)).toBeNull()
	})

	it('forgets a cancelled gesture', () => {
		const gesture = createSwipeGesture()

		gesture.start(280, 400)
		gesture.cancel()

		expect(gesture.end(150, 400)).toBeNull()
	})

	it('starts each gesture clean after a scroll', () => {
		const gesture = createSwipeGesture()

		gesture.start(200, 400)
		gesture.move(210, 250)
		expect(gesture.end(264, 400)).toBeNull()

		gesture.start(280, 400)
		gesture.move(160, 404)
		expect(gesture.end(150, 406)).toBe(1)
	})
})
