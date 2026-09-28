import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue'

import { useBrowserZoomGuard } from './useBrowserZoomGuard'

const Page = defineComponent({
	setup() {
		useBrowserZoomGuard()
		return () => h('div', 'page')
	},
})

const Home = defineComponent({
	setup: () => () => h('div', 'home'),
})

const onPage = ref(true)
let app: ReturnType<typeof createApp> | null = null

const mountShell = () => {
	onPage.value = true
	app = createApp({
		render: () => h(KeepAlive, null, [onPage.value ? h(Page) : h(Home)]),
	})
	app.mount(document.createElement('div'))
}

const wheelCancelled = (init: WheelEventInit = {}) => {
	const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
	document.body.dispatchEvent(event)
	return event.defaultPrevented
}

afterEach(() => {
	app?.unmount()
	app = null
})

describe('browser zoom guard', () => {
	it('cancels modifier-held wheel while the page is active', () => {
		mountShell()

		expect(wheelCancelled({ ctrlKey: true })).toBe(true)
		expect(wheelCancelled({ metaKey: true })).toBe(true)
	})

	it('leaves plain wheel alone so panels still scroll', () => {
		mountShell()

		expect(wheelCancelled()).toBe(false)
	})

	it('stops cancelling once the page is cached behind Home', async () => {
		mountShell()
		onPage.value = false
		await nextTick()

		expect(wheelCancelled({ ctrlKey: true })).toBe(false)
	})

	it('cancels again when the cached page is reactivated', async () => {
		mountShell()
		onPage.value = false
		await nextTick()
		onPage.value = true
		await nextTick()

		expect(wheelCancelled({ ctrlKey: true })).toBe(true)
	})

	it('stops cancelling once the shell is unmounted', () => {
		mountShell()
		app?.unmount()
		app = null

		expect(wheelCancelled({ ctrlKey: true })).toBe(false)
	})
})
