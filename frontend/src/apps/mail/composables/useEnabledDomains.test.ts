import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

const resource = reactive({ data: null as string[] | null, error: null as unknown, fetch: vi.fn() })
const createResource = vi.fn(() => resource)
vi.mock('frappe-ui', () => ({ createResource: (options: unknown) => createResource(options) }))
vi.stubGlobal('__', (text: string) => text)

import { useEnabledDomains } from './useEnabledDomains'

describe('the domains offered by an add dialog', () => {
	beforeEach(() => {
		resource.data = null
		resource.error = null
		resource.fetch.mockClear()
	})

	it('are read when the dialog opens, and again the next time', async () => {
		const show = ref(false)
		useEnabledDomains(show)
		expect(resource.fetch).not.toHaveBeenCalled()

		show.value = true
		await nextTick()
		show.value = false
		await nextTick()
		show.value = true
		await nextTick()
		expect(resource.fetch).toHaveBeenCalledTimes(2)
	})

	it('are read at once by a dialog that mounts already open', () => {
		useEnabledDomains(ref(true))
		expect(resource.fetch).toHaveBeenCalledTimes(1)
	})

	// A Combobox given `null` options fails to render, and the dialog's domain field with it.
	it('are an empty list, not null, until the read answers', () => {
		useEnabledDomains(ref(true))
		expect(createResource).toHaveBeenCalledWith(expect.objectContaining({ initialData: [] }))
	})

	it('say why they are missing when Suite Cloud cannot be reached', () => {
		const { domainsError } = useEnabledDomains(ref(true))
		expect(domainsError.value).toBe('')

		resource.error = { messages: ['Suite Cloud is unreachable; try again shortly.'] }
		expect(domainsError.value).toBe('Suite Cloud is unreachable; try again shortly.')

		resource.error = {}
		expect(domainsError.value).toBe('Could not load the domains.')
	})
})
