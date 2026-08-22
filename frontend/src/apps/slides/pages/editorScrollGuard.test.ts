import { describe, expect, it } from 'vitest'

import source from './PresentationEditor.vue?raw'

describe('editor root overflow', () => {
	// a hidden root is still a scroll container, so a caret past its edge drags the chrome
	it('clips the editor root instead of only hiding it', () => {
		const rootClass = source.match(/class="isolate[^"]*"/)?.[0]

		expect(rootClass).toContain('overflow-clip')
	})
})
