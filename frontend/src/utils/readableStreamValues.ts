// Safari has never shipped async iteration over a ReadableStream. pdf.js reads a page's text layer
// with `for await (const value of readableStream)`, and decodes image data through another one in
// its worker, so on iOS a PDF draws its canvas and then dies — "undefined is not a function (near
// '...value of readableStream...')", which reaches the reader as a viewer that rendered nothing.
//
// The spec'd shape is short enough to stand in for. Feature-detected, so it takes itself out of the
// way the day WebKit ships its own, and a module of its own because the page and the worker are
// separate global scopes: each has to install it.
export function streamValues(this: ReadableStream, { preventCancel = false } = {}) {
	const reader = this.getReader()

	return {
		async next() {
			try {
				const result = await reader.read()
				if (result.done) reader.releaseLock()
				return result
			} catch (error) {
				reader.releaseLock()
				throw error
			}
		},
		// The lock goes back in a `finally`: a cancel that rejects still has to leave the stream
		// readable by whoever comes next, and the rejection is the caller's to see.
		async return(value: unknown) {
			try {
				if (!preventCancel) await reader.cancel(value)
			} finally {
				reader.releaseLock()
			}
			return { done: true, value }
		},
		[Symbol.asyncIterator]() {
			return this
		},
	}
}

// Both names, as the stream spec defines them: `values()` is the method, and the async-iterator
// symbol is the same function under its well-known key.
if (!(Symbol.asyncIterator in ReadableStream.prototype)) {
	for (const key of [Symbol.asyncIterator, 'values'] as const) {
		Object.defineProperty(ReadableStream.prototype, key, {
			value: streamValues,
			writable: true,
			configurable: true,
		})
	}
}
