// Safari has never shipped async iteration over a ReadableStream. pdf.js reads a page's text layer
// with `for await (const value of readableStream)`, and decodes image data through another one in
// its worker, so on iOS a PDF draws its canvas and then dies — "undefined is not a function (near
// '...value of readableStream...')", which reaches the reader as a viewer that rendered nothing.
//
// The spec'd shape is short enough to stand in for. Feature-detected, so it takes itself out of the
// way the day WebKit ships its own, and a module of its own because the page and the worker are
// separate global scopes: each has to install it.
if (!(Symbol.asyncIterator in ReadableStream.prototype)) {
	const values = function (this: ReadableStream, { preventCancel = false } = {}) {
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
			async return(value: unknown) {
				if (!preventCancel) await reader.cancel(value)
				reader.releaseLock()
				return { done: true, value }
			},
			[Symbol.asyncIterator]() {
				return this
			},
		}
	}

	// Both names, as the stream spec defines them: `values()` is the method, and the async-iterator
	// symbol is the same function under its well-known key.
	for (const key of [Symbol.asyncIterator, 'values'] as const) {
		Object.defineProperty(ReadableStream.prototype, key, {
			value: values,
			writable: true,
			configurable: true,
		})
	}
}
