import { createApp, defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Resources the component creates, captured by URL so a test can drive the
// server's answer (onSuccess / onError) after inspecting the submitted params.
const resources = vi.hoisted(() => new Map<string, FakeResource>())
const toasts = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({ store: null as unknown as Store }))

type FakeResource = {
	loading: boolean
	params: unknown
	submit: () => void
	onSuccess: (data?: unknown) => void
	onError: (error: unknown) => void
}
type IdentityRow = { name: string; id: string; email: string; _name: string; may_delete: 0 | 1 }
type Store = { accountId: string; identities: { data: IdentityRow[]; loading: boolean; reload: () => void } }

vi.mock('frappe-ui', async () => {
	const { defineComponent, h } = await import('vue')
	return {
		Button: defineComponent({
			inheritAttrs: false,
			setup(_props, { attrs, slots }) {
				return () => h('button', attrs, slots.default?.() ?? (attrs.label as string))
			},
		}),
		FormControl: defineComponent({
			inheritAttrs: false,
			setup(_props, { attrs }) {
				return () => h('input', { 'data-label': attrs.label, value: attrs.modelValue })
			},
		}),
		// Renders like the real one only in what the tests look at: nothing while closed,
		// the message and one button per action while open.
		Dialog: defineComponent({
			inheritAttrs: false,
			setup(_props, { attrs, slots }) {
				return () => {
					if (!attrs.open) return null
					const actions = (attrs.actions as { label: string; onClick: () => void }[]) || []
					return h('div', { 'data-dialog': attrs.title }, [
						attrs.message ? h('p', String(attrs.message)) : null,
						slots.default?.(),
						...actions.map((a) => h('button', { onClick: a.onClick }, a.label)),
					])
				}
			},
		}),
		createResource: (options: {
			url: string
			makeParams: () => unknown
			onSuccess: (data?: unknown) => void
			onError: (error: unknown) => void
		}) => {
			const resource: FakeResource = {
				loading: false,
				params: null,
				submit: () => {
					resource.params = options.makeParams()
				},
				onSuccess: options.onSuccess,
				onError: options.onError,
			}
			resources.set(options.url, resource)
			return resource
		},
		createDocumentResource: ({ name }: { name: string }) => {
			const row = state.store.identities.data.find((i) => i.name === name)
			const doc = row ? { ...row, reply_to: [], bcc: [], html_signature: '' } : null
			return { doc, originalDoc: doc, loading: false, get: { loading: false }, save: { loading: false } }
		},
		useList: () => ({ data: [] }),
	}
})
vi.mock('frappe-ui/experimental', () => ({ TextEditor: defineComponent({ render: () => h('div') }) }))
vi.mock('@/components/settings/AppSettingsHeader.vue', () => ({
	default: defineComponent({
		inheritAttrs: false,
		setup(_props, { slots }) {
			return () => h('div', slots.actions?.())
		},
	}),
}))
vi.mock('@/components/settings/AppSettingsBody.vue', () => ({
	default: defineComponent({
		setup(_props, { slots }) {
			return () => h('div', slots.default?.())
		},
	}),
}))
vi.mock('@/apps/mail/components/IdentitySettingsListView.vue', () => ({
	default: defineComponent({ render: () => h('div') }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: toasts }))
vi.mock('@/apps/mail/utils/composables', async () => {
	const { ref } = await import('vue')
	return { useScreenSize: () => ({ isMobile: ref(false) }), useTextEditorButtons: () => ({ buttons: [] }) }
})
vi.mock('@/apps/mail/utils/text-editor', () => ({ CustomParagraphExtension: {} }))
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => state.store }))

import IdentitySettings from './IdentitySettings.vue'

const DELETE_URL = 'suite.mail.doctype.identity.identity.bulk_delete'

const primary: IdentityRow = { name: 'oa|a', id: 'a', email: 'me@example.com', _name: 'Me', may_delete: 1 }
const alias: IdentityRow = { name: 'oa|b', id: 'b', email: 'me@example.com', _name: 'Alias', may_delete: 1 }

function mount(identities: IdentityRow[]) {
	state.store = { accountId: 'oa', identities: reactive({ data: identities, loading: false, reload: vi.fn() }) }
	const root = document.createElement('div')
	const app = createApp(defineComponent({ render: () => h(IdentitySettings) }))
	app.config.globalProperties.__ = window.__
	app.provide('$user', { data: { name: 'me@example.com' } })
	app.mount(root)
	return { app, root, identities: state.store.identities }
}

const button = (root: HTMLElement, text: string) =>
	[...root.querySelectorAll('button')].find((b) => b.textContent === text) ?? null

const displayName = (root: HTMLElement) =>
	root.querySelector<HTMLInputElement>('input[data-label="Display Name"]')?.value

const confirmDialog = (root: HTMLElement) => root.querySelector('[data-dialog="Delete Identity"]')

let mounted: ReturnType<typeof mount> | null = null

beforeEach(() => {
	window.__ = (message: string) => message
	resources.clear()
	toasts.mockReset()
})
afterEach(() => mounted?.app.unmount())

describe('IdentitySettings delete', () => {
	it('offers Delete only when the server says the identity may be deleted', async () => {
		mounted = mount([{ ...primary, may_delete: 0 }, alias])
		const { root } = mounted
		expect(displayName(root)).toBe('Me')
		expect(button(root, 'Delete')).toBeNull()

		mounted.app.unmount()
		mounted = mount([primary, alias])
		expect(button(mounted.root, 'Delete')).not.toBeNull()
	})

	it('asks for confirmation, then deletes the selected identity by name', async () => {
		mounted = mount([primary, alias])
		const { root } = mounted
		expect(confirmDialog(root)).toBeNull()

		button(root, 'Delete')!.click()
		await nextTick()
		expect(confirmDialog(root)?.textContent).toContain('Are you sure you want to delete this identity?')
		expect(resources.get(DELETE_URL)!.params).toBeNull()

		button(root, 'Confirm')!.click()
		expect(resources.get(DELETE_URL)!.params).toEqual({ names: ['oa|a'] })
	})

	it('falls back to the first remaining identity after a delete', async () => {
		mounted = mount([primary, alias])
		const { root, identities } = mounted
		button(root, 'Delete')!.click()
		await nextTick()
		button(root, 'Confirm')!.click()

		resources.get(DELETE_URL)!.onSuccess()
		await nextTick()
		expect(confirmDialog(root)).toBeNull()
		expect(toasts).toHaveBeenCalledWith('Identity deleted.')
		expect(identities.reload).toHaveBeenCalled()

		// The reload answers without the deleted row.
		identities.data = [alias]
		await nextTick()
		await nextTick()
		expect(displayName(root)).toBe('Alias')
	})

	it('shows the empty state once the last identity is gone', async () => {
		mounted = mount([primary])
		const { root, identities } = mounted
		button(root, 'Delete')!.click()
		await nextTick()
		button(root, 'Confirm')!.click()
		resources.get(DELETE_URL)!.onSuccess()
		identities.data = []
		await nextTick()
		await nextTick()

		expect(root.textContent).toContain('No identities.')
		expect(displayName(root)).toBeUndefined()
		expect(button(root, 'Delete')).toBeNull()
		expect(button(root, 'New')).not.toBeNull()
	})

	it('keeps the identity selected and reports the error when the server refuses', async () => {
		mounted = mount([primary, alias])
		const { root } = mounted
		button(root, 'Delete')!.click()
		await nextTick()
		button(root, 'Confirm')!.click()

		resources.get(DELETE_URL)!.onError({ messages: ['Identity Deletion Error'] })
		await nextTick()
		expect(confirmDialog(root)).toBeNull()
		expect(toasts).toHaveBeenCalledWith('Identity Deletion Error', 'error')
		expect(displayName(root)).toBe('Me')
	})
})
