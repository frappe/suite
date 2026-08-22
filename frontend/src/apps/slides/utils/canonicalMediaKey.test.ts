import { describe, expect, it } from 'vitest'

import { canonicalMediaKey } from '@/apps/slides/utils/canonicalMediaKey'

const proxyUrl = (src: string, presentation = 'pres-1') =>
	`/api/method/suite.slides.api.file.get_media_file?src=${encodeURIComponent(
		src,
	)}&presentation=${encodeURIComponent(presentation)}`

describe('canonicalMediaKey', () => {
	it('keeps an owner file path and drops its query', () => {
		expect(canonicalMediaKey('/private/files/photo.png')).toBe('/private/files/photo.png')
		expect(canonicalMediaKey('/private/files/photo.png?slides_media=1')).toBe(
			'/private/files/photo.png',
		)
	})

	it('adds the /private prefix that getAttachmentUrl adds', () => {
		expect(canonicalMediaKey('/files/photo.png')).toBe('/private/files/photo.png')
	})

	it('unwraps the proxy url to the same key as the owner url', () => {
		const owner = '/private/files/photo.png'
		expect(canonicalMediaKey(proxyUrl(owner))).toBe(owner)
		expect(canonicalMediaKey(proxyUrl(owner))).toBe(
			canonicalMediaKey(`${owner}?slides_media=1`),
		)
	})

	it('unwraps a proxy url whose src still needs the /private prefix', () => {
		expect(canonicalMediaKey(proxyUrl('/files/photo.png'))).toBe('/private/files/photo.png')
	})

	it('encodes both url shapes the same way', () => {
		const owner = '/private/files/holiday photo & co.png'
		const encoded = '/private/files/holiday%20photo%20&%20co.png'
		expect(canonicalMediaKey(`${owner}?slides_media=1`)).toBe(encoded)
		expect(canonicalMediaKey(proxyUrl(owner))).toBe(encoded)
	})

	it('resolves an absolute url to the same key as a relative one', () => {
		expect(canonicalMediaKey('https://suite.localhost:8025/private/files/photo.png')).toBe(
			'/private/files/photo.png',
		)
	})

	it('returns null for anything that is not pinnable media', () => {
		expect(canonicalMediaKey('data:image/png;base64,iVBORw0KGgo=')).toBeNull()
		expect(canonicalMediaKey('/assets/suite/slides/logo.svg')).toBeNull()
		expect(canonicalMediaKey('/api/method/suite.slides.api.presentation.get')).toBeNull()
		expect(canonicalMediaKey('/private/backups/dump.sql')).toBeNull()
		expect(canonicalMediaKey('/files')).toBeNull()
	})

	it('returns null for a proxy url with no usable src', () => {
		expect(canonicalMediaKey(`${'/api/method/suite.slides.api.file.get_media_file'}`)).toBeNull()
		expect(canonicalMediaKey(proxyUrl('/assets/suite/slides/logo.svg'))).toBeNull()
	})

	it('returns null for empty input', () => {
		expect(canonicalMediaKey('')).toBeNull()
		expect(canonicalMediaKey(null)).toBeNull()
		expect(canonicalMediaKey(undefined)).toBeNull()
	})
})
