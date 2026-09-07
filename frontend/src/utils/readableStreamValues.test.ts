import { describe, expect, it } from 'vitest'

import { streamValues } from './readableStreamValues'

// The stand-in is exercised directly rather than through the prototype: every runtime that runs
// these tests already has async iteration, so the install in the module under test is a no-op here.
const iterate = (stream: ReadableStream, options?: { preventCancel?: boolean }) =>
	streamValues.call(stream, options)

const counting = () =>
	new ReadableStream({
		start(controller) {
			controller.enqueue(1)
			controller.enqueue(2)
			controller.enqueue(3)
			controller.close()
		},
	})

describe('streamValues', () => {
	it('yields every chunk and releases the lock at the end', async () => {
		const stream = counting()

		const seen = []
		for await (const value of iterate(stream)) seen.push(value)

		expect(seen).toEqual([1, 2, 3])
		expect(stream.locked).toBe(false)
	})

	it('cancels the stream when the loop breaks early', async () => {
		const stream = counting()

		for await (const value of iterate(stream)) {
			expect(value).toBe(1)
			break
		}

		expect(stream.locked).toBe(false)
		await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
	})

	it('leaves the rest readable under preventCancel', async () => {
		const stream = counting()

		const iterator = iterate(stream, { preventCancel: true })
		await iterator.next()
		await iterator.return(undefined)

		const rest = []
		for await (const value of iterate(stream)) rest.push(value)
		expect(rest).toEqual([2, 3])
	})

	it("surfaces a stream's error and releases the lock", async () => {
		const stream = new ReadableStream({
			start: (controller) => controller.error(new Error('boom')),
		})

		await expect(async () => {
			for await (const value of iterate(stream)) void value
		}).rejects.toThrow('boom')
		expect(stream.locked).toBe(false)
	})

	it('releases the lock even when cancelling rejects', async () => {
		const stream = new ReadableStream({
			start: (controller) => controller.enqueue(1),
			cancel: () => Promise.reject(new Error('cancel failed')),
		})

		const iterator = iterate(stream)
		await iterator.next()

		await expect(iterator.return(undefined)).rejects.toThrow('cancel failed')
		expect(stream.locked).toBe(false)
	})
})
