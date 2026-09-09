import { computed, reactive, ref, type Ref } from 'vue'
import { createResource } from 'frappe-ui'

// The page lengths the desk list view offers, with the same default.
export const PAGE_LENGTHS = [20, 100, 500] as const
export type PageLength = (typeof PAGE_LENGTHS)[number]
export const DEFAULT_PAGE_LENGTH: PageLength = 100

type Page<T> = { items: T[]; total: number }

// Desk-style paging: rows accumulate as the admin loads more, and a new search or filter starts
// over from the first page. The API takes `start` and `page_length` and answers `{items, total}`.
export function usePagedList<T>(url: string, params: () => Record<string, unknown>) {
	const rows = ref<T[]>([]) as Ref<T[]>
	const total = ref(0)
	const pageLength = ref<PageLength>(DEFAULT_PAGE_LENGTH)
	const loaded = ref(false)
	// A reload starts a new generation; a response from an older one (a Load More still in
	// flight when the search changed, say) is dropped instead of overwriting the fresh rows.
	let generation = 0

	const resource = createResource({ url })

	const fetch = (start: number) => {
		const appending = start > 0
		if (!appending) generation += 1
		const mine = generation
		return resource.submit({ ...params(), start, page_length: pageLength.value }).then((page: Page<T>) => {
			if (mine !== generation) return page
			rows.value = appending ? [...rows.value, ...page.items] : page.items
			total.value = page.total
			loaded.value = true
			return page
		})
	}
	const reload = () => fetch(0)
	const loadMore = () => fetch(rows.value.length)
	const setPageLength = (value: PageLength) => {
		pageLength.value = value
		return reload()
	}

	reload()

	return reactive({
		rows,
		total,
		pageLength,
		loaded,
		loading: computed(() => resource.loading),
		hasMore: computed(() => rows.value.length < total.value),
		reload,
		loadMore,
		setPageLength,
	})
}
