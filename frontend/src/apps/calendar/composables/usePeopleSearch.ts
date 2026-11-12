import { computed, nextTick, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { createResource } from 'frappe-ui'

/**
 * A field that finds people as it is typed in, for a Combobox: the search is debounced, its
 * matches exist only for a typed query, and picking one clears the field for the next. Shared
 * by the event form's participant picker and the share dialog's, which differ in what they do
 * with a match, not in how they find one.
 */
export const usePeopleSearch = <T extends { value: string }>(options: {
	url: string
	makeParams: (text: string) => Record<string, unknown>
	transform?: (data: any[]) => T[]
	debounce?: number
}) => {
	const query = ref('')
	// True from the keystroke until the search it starts has answered. `resource.loading` alone
	// is not that: the request is debounced, so between typing and sending there is a window
	// where nothing is in flight and nothing has come back either.
	const pending = ref(false)
	const open = ref(false)
	const combobox = ref<{ clear: () => void } | null>(null)

	const resource = createResource({
		url: options.url,
		makeParams: options.makeParams,
		transform: options.transform,
		onSuccess: () => (pending.value = false),
		onError: () => (pending.value = false),
	})

	const search = useDebounceFn(
		(text: string) => text && resource.reload(text),
		options.debounce ?? 300,
	)

	watch(query, (text) => {
		pending.value = !!text
		search(text)
	})

	// Matches exist only for a typed query — with the field empty the popover would show the
	// last query's matches, or a bare "No results" — so a focus or arrow-key open is refused too.
	watch(open, (isOpen) => {
		if (isOpen && !query.value) open.value = false
	})

	const onQuery = (text: string) => {
		query.value = text
		if (!text) open.value = false
	}

	const matches = computed<T[]>(() =>
		query.value ? (resource.data as T[] | undefined) || [] : [],
	)

	/** The match a Combobox committed, by its value. */
	const find = (value: string) =>
		(resource.data as T[] | undefined)?.find(
			(match) => match.value.toLowerCase() === value.toLowerCase(),
		)

	// Picking a match commits it as the Combobox's value. The field is cleared for the next one
	// a tick later: the Combobox writes the label into its input right after the pick, which a
	// synchronous clear would be undone by.
	const clear = async () => {
		query.value = ''
		await nextTick()
		combobox.value?.clear()
	}

	return { query, pending, open, combobox, matches, onQuery, find, clear }
}
