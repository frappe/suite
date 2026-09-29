import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftRecipient } from '@/apps/mail/types'
import type { RecipientField } from '@/apps/mail/utils/recipientFields'

// Whether the field believes it is on a phone — the chip menu exists only there, so each test
// says which it is before mounting.
const isMobile = vi.hoisted(() => ({ value: true }))

vi.mock('frappe-ui', async () => {
	const { defineComponent, h } = await import('vue')
	return {
		// Marks the element it stands for: the chips carry one, the menu's header carries one,
		// and telling the two apart is how a test finds a chip.
		Avatar: defineComponent({
			inheritAttrs: false,
			setup(_props, { attrs }) {
				return () => h('span', { 'data-avatar': attrs.label })
			},
		}),
		// Only the input matters here — the field focuses it, and the component reads the typed
		// text off its own model rather than the DOM.
		Combobox: defineComponent({
			inheritAttrs: false,
			setup() {
				return () => h('input')
			},
		}),
		// Renders nothing while closed, and the menu's contents while open — which is all the
		// anchoring and dismissal behaviour a test can see.
		Popover: defineComponent({
			inheritAttrs: false,
			setup(_props, { attrs, slots }) {
				return () => (attrs.open ? h('div', { 'data-menu': '' }, slots.default?.()) : null)
			},
		}),
		createResource: () => ({ data: [], reload: vi.fn() }),
	}
})
vi.mock('@vueuse/core', () => ({
	onClickOutside: () => {},
	useResizeObserver: () => {},
	useDebounceFn: (fn: unknown) => fn,
}))
vi.mock('@/apps/mail/utils/composables', async () => {
	const { computed } = await import('vue')
	return { useScreenSize: () => ({ isMobile: computed(() => isMobile.value) }) }
})
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => ({ accountId: 'oa' }) }))

import RecipientInput from './RecipientInput.vue'

const amy: DraftRecipient = { email: 'amy@example.com', display_name: 'Amy Diaz' }
const bo: DraftRecipient = { email: 'bo@example.com', display_name: 'Bo Chen' }

function mount(recipients: DraftRecipient[], field: RecipientField = 'to') {
	const model = ref<DraftRecipient[]>([...recipients])
	const moves: [string, RecipientField, RecipientField][] = []
	const revealedCcBcc = vi.fn()

	const root = document.createElement('div')
	document.body.appendChild(root)
	const app = createApp(
		defineComponent({
			render: () =>
				h(RecipientInput, {
					field,
					modelValue: model.value,
					'onUpdate:modelValue': (value: DraftRecipient[]) => (model.value = value),
					onMove: (recipient: DraftRecipient, from: RecipientField, to: RecipientField) =>
						moves.push([recipient.email, from, to]),
					onShowCcBcc: revealedCcBcc,
				}),
		}),
	)
	app.config.globalProperties.__ = window.__
	app.mount(root)
	return { app, root, model, moves, revealedCcBcc }
}

/** The recipient chips: the buttons carrying an avatar. The menu's header has one too, but no button. */
const chips = (root: HTMLElement) =>
	[...root.querySelectorAll('button')].filter((b) => b.querySelector('[data-avatar]'))

const menu = (root: HTMLElement) => root.querySelector('[data-menu]')

const menuItem = (root: HTMLElement, label: string) =>
	[...(menu(root)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label) ??
	null

/** A tap on a chip, close enough: the row expands on the click before it. */
const tapChip = async (root: HTMLElement, index: number) => {
	root.querySelector('[data-recipient-input]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await nextTick()
	chips(root)[index]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await nextTick()
}

beforeEach(() => {
	window.__ = (message: string, args?: string[]) =>
		args ? message.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]) : message
	isMobile.value = true
	document.body.innerHTML = ''
})

describe('RecipientInput chip menu', () => {
	it('opens on the chip that was tapped, and says which address that is', async () => {
		const { root } = mount([amy, bo])
		expect(menu(root)).toBeNull()

		await tapChip(root, 1)

		expect(menu(root)?.textContent).toContain('Bo Chen')
		expect(menu(root)?.textContent).toContain('bo@example.com')
		expect(menu(root)?.textContent).not.toContain('amy@example.com')
	})

	it('re-addresses that recipient, and asks for the field it lands in to be shown', async () => {
		const { root, moves, revealedCcBcc } = mount([amy, bo])
		await tapChip(root, 1)

		menuItem(root, 'Move to Bcc')!.click()
		await nextTick()

		expect(moves).toEqual([['bo@example.com', 'to', 'bcc']])
		expect(revealedCcBcc).toHaveBeenCalled()
		// The move belongs to the draft, so the field itself lets both recipients stand.
		expect(chips(root)).toHaveLength(2)
		expect(menu(root)).toBeNull()
	})

	it('offers every field but the one the chip is already in', async () => {
		const { root } = mount([amy], 'cc')
		await tapChip(root, 0)

		expect(menuItem(root, 'Move to To')).not.toBeNull()
		expect(menuItem(root, 'Move to Bcc')).not.toBeNull()
		expect(menuItem(root, 'Move to Cc')).toBeNull()
	})

	it('takes the recipient off the mail on Remove, which the field does itself', async () => {
		const { root, model, moves } = mount([amy, bo])
		await tapChip(root, 0)

		menuItem(root, 'Remove')!.click()
		await nextTick()

		expect(model.value.map((r) => r.email)).toEqual(['bo@example.com'])
		expect(moves).toEqual([])
		expect(menu(root)).toBeNull()
	})

	it('carries no ✕ on a chip: Remove is in the menu the chip opens', async () => {
		const { root } = mount([amy])
		await nextTick()

		expect(chips(root)[0].querySelector('svg')).toBeNull()
	})
})

describe('RecipientInput chips on desktop', () => {
	beforeEach(() => {
		isMobile.value = false
	})

	it('keeps the ✕, which takes the recipient off the mail', async () => {
		const { root, model } = mount([amy, bo])
		await nextTick()

		const remove = chips(root)[0].querySelector('svg')
		expect(remove).not.toBeNull()

		remove!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		await nextTick()
		expect(model.value.map((r) => r.email)).toEqual(['bo@example.com'])
	})

	it('opens no menu on a chip: a recipient is dragged between fields there', async () => {
		const { root } = mount([amy, bo])
		await tapChip(root, 1)

		expect(menu(root)).toBeNull()
	})
})
