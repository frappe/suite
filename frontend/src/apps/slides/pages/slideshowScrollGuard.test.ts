import { describe, expect, it } from 'vitest'

import source from './Slideshow.vue?raw'

describe('slideshow root overflow', () => {
	// elements past the slide edge would otherwise grow the document and show scrollbars
	it('clips the slideshow root', () => {
		const rootClass = source.match(/class="absolute left-0 top-0 h-full w-full[^"]*"/)?.[0]

		expect(rootClass).toContain('overflow-clip')
	})
})
