import { describe, expect, it } from 'vitest'

import { collectMediaSources, presentationLoadRequests } from '@/apps/slides/utils/pinTargets'

describe('collectMediaSources', () => {
	it('walks image src and poster and video poster with the slide index, never a video body', () => {
		const slides = [
			{ elements: [{ type: 'text' }, { type: 'image', src: '/files/a.png' }] },
			{ elements: [{ type: 'video', src: '/files/b.mp4', poster: '/files/b.png' }] },
			{ elements: [{ type: 'image', src: '/files/c.gif', poster: '/files/c.png' }] },
		]
		expect(collectMediaSources(slides)).toEqual([
			{ slideIndex: 0, src: '/files/a.png' },
			{ slideIndex: 1, src: '/files/b.png' },
			{ slideIndex: 2, src: '/files/c.gif' },
			{ slideIndex: 2, src: '/files/c.png' },
		])
	})

	it('dedupes a url used on several slides, keeping its first slide', () => {
		const slides = [
			{ elements: [{ type: 'image', src: '/files/a.png' }] },
			{ elements: [{ type: 'image', src: '/files/a.png' }] },
		]
		expect(collectMediaSources(slides)).toEqual([{ slideIndex: 0, src: '/files/a.png' }])
	})

	it('skips elements without a url and slides without elements', () => {
		const slides = [{}, { elements: [{ type: 'image' }, { type: 'shape', src: '/files/x.png' }] }]
		expect(collectMediaSources(slides)).toEqual([])
	})
})

describe('presentationLoadRequests', () => {
	const access = {
		url: 'suite.slides.doctype.presentation.presentation.get_editor_access',
		params: { doctype: 'Presentation', presentation_id: 'p1' },
	}

	it('mirrors the editable load path', () => {
		expect(presentationLoadRequests('p1', { readonly: false, composite: false })).toEqual([
			access,
			{ url: 'frappe.client.get', params: { doctype: 'Presentation', name: 'p1' } },
		])
	})

	it('mirrors the readonly load path', () => {
		expect(presentationLoadRequests('p1', { readonly: true, composite: false })).toEqual([
			access,
			{
				url: 'suite.slides.doctype.presentation.presentation.get_public_presentation',
				params: { name: 'p1' },
			},
		])
	})

	it('adds the composite read after the public one', () => {
		const urls = presentationLoadRequests('p1', { readonly: true, composite: true }).map(
			(r) => r.url,
		)
		expect(urls.at(-1)).toBe(
			'suite.slides.doctype.presentation.presentation.get_composite_presentation',
		)
		expect(urls).toHaveLength(3)
	})

	it('keeps param insertion order, which decides the request url', () => {
		const [first] = presentationLoadRequests('p1', { readonly: false, composite: false })
		expect(Object.keys(first.params)).toEqual(['doctype', 'presentation_id'])
	})
})
