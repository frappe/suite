import { createApp, nextTick } from 'vue'
import type { App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EmailContent from '@/apps/mail/components/EmailContent.vue'

// The stubbed frame hands its emit back, so a test can say when the resizer reports ready.
const resizer = vi.hoisted(() => ({ reportReady: () => {} }))

vi.mock('@iframe-resizer/vue/iframe-resizer.vue', async () => {
	const { defineComponent, h } = await import('vue')
	return {
		default: defineComponent({
			emits: ['onReady'],
			setup(_props, { emit }) {
				resizer.reportReady = () => emit('onReady')
				return () => h('iframe', { 'data-frame': '' })
			},
		}),
	}
})

vi.mock('@iframe-resizer/child/index.umd.js?raw', () => ({ default: '' }))

vi.mock('@/apps/mail/utils', () => ({
	analyzeRemoteAssets: () => ({ images: 0, hasRemote: false }),
	blockRemoteAssets: (html: string) => html,
}))

vi.mock('@/apps/mail/utils/composables', () => ({
	useTheme: () => ({ dataTheme: { value: 'light' } }),
	useScreenSize: () => ({ isMobile: { value: false } }),
	useComposeMail: () => ({ requestCompose: () => {} }),
}))

// Torn down between tests: the component listens on `window` for the frame's messages, and a
// mount left standing would still be listening while the next test runs.
const mounted: App[] = []

const mount = () => {
	const root = document.createElement('div')
	document.body.appendChild(root)
	const app = createApp(EmailContent, { content: '<p>A message with a body.</p>' })
	app.mount(root)
	mounted.push(app)
	return root
}

const frame = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-frame]')
const placeholder = (root: HTMLElement) => root.querySelector('.animate-pulse')

beforeEach(() => {
	window.__ = (message: string) => message
	resizer.reportReady = () => {}
	document.body.innerHTML = ''
})

afterEach(() => {
	mounted.splice(0).forEach((app) => app.unmount())
})

describe('EmailContent', () => {
	// The frame is measured by asking the document inside it how tall it is, so it has to be laid
	// out the whole time — taken out of the layout it reports 1px, and stops reporting at all.
	it('lays the frame out while it is still waiting to be ready', async () => {
		const root = mount()
		await nextTick()

		expect(frame(root)).not.toBeNull()
		expect(frame(root)!.style.display).not.toBe('none')
		expect(placeholder(root)).not.toBeNull()
	})

	it('shows the frame and drops the placeholder once the resizer reports ready', async () => {
		const root = mount()
		await nextTick()

		resizer.reportReady()
		await nextTick()

		expect(frame(root)!.style.display).not.toBe('none')
		expect(frame(root)!.className).not.toContain('invisible')
		expect(placeholder(root)).toBeNull()
	})
})
