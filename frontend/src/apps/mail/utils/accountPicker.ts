import { computed, reactive, ref, watch, type Ref } from 'vue'
import { createResource } from 'frappe-ui'
import { watchDebounced } from '@vueuse/core'

export type AccountOption = { id: string; name: string; email: string }

// Server-side search for the account pickers: a site may hold thousands of accounts, so the
// dialog shows a short page matching what the admin typed. Rows already picked stay in the
// options after the search moves on, or the MultiSelect could not show them as selected.
export function useAccountPicker(selected: Ref<string[]>, exclude: () => string[] = () => []) {
	const query = ref('')
	const picked = ref<AccountOption[]>([])

	const accounts = createResource({
		url: 'suite.mail.api.admin.get_accounts',
		makeParams: () => ({ search: query.value.trim() || undefined }),
		auto: true,
	})
	watchDebounced(query, () => accounts.reload(), { debounce: 300 })

	watch(selected, (ids) => {
		const known = new Map<string, AccountOption>(
			[...picked.value, ...((accounts.data || []) as AccountOption[])].map((a) => [a.id, a]),
		)
		picked.value = ids.map((id) => known.get(id)).filter((a): a is AccountOption => !!a)
	})

	const options = computed(() => {
		const excluded = new Set(exclude())
		const seen = new Set<string>()
		return [...picked.value, ...((accounts.data || []) as AccountOption[])]
			.filter((a) => !excluded.has(a.id) && !seen.has(a.id) && seen.add(a.id))
			.map((a) => ({ label: a.email, value: a.id }))
	})

	const reset = () => {
		query.value = ''
		picked.value = []
		accounts.reload()
	}

	return reactive({ query, options, loading: computed(() => accounts.loading), reset })
}
