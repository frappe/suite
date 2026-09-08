import { computed, ref, type Component } from 'vue'
import { Mail as MailIcon, Mails, Paperclip, Star } from 'lucide-vue-next'

import { userStore } from '@/apps/mail/stores/user'

/** One entry of the filter menu — what the toolbar hands to Dropdown/AdaptiveDropdown. */
export interface FilterOption {
	label: string
	icon: Component
	onClick: () => void
	selected: boolean
	condition?: () => boolean
}

interface StoredFilterOptions {
	/**
	 * What the remembered choice is remembered FOR — a mailbox id, or 'all-inboxes' for the merged
	 * list. A getter, since the mailbox view switches mailbox without remounting.
	 */
	scope: () => string
	/** Apply the new filter: refetch the first window. */
	onChange: () => void
	/**
	 * Whether the Starred filter is offered. Off inside Trash and inside the Starred list itself,
	 * where it would filter a list to itself.
	 */
	starrable?: () => boolean
}

/**
 * The list filter — All / Unread / Starred / Has attachments — remembered per list, its menu, and the
 * title the toolbar shows for it. All three were duplicated verbatim between the mailbox list and the
 * merged All Inboxes list, down to the localStorage key's shape.
 */
export const useStoredFilter = ({ scope, onChange, starrable = () => true }: StoredFilterOptions) => {
	const { userResource } = userStore()

	const storageKey = () => `user:${userResource.data?.name}:filter:${scope()}`

	const filter = ref<string | null>(localStorage.getItem(storageKey()) || null)

	const setFilter = (value: string | null) => {
		filter.value = value
		localStorage.setItem(storageKey(), value ?? '')
		onChange()
	}

	/** Re-read the remembered choice after the scope changed (a mailbox switch). */
	const reloadFilter = () => (filter.value = localStorage.getItem(storageKey()) || null)

	// Computed, not a constant array: `selected` is the menu's own boolean field (frappe-ui
	// reads it as `Boolean(option.selected)`, so it can't be a getter), and it has to be
	// re-evaluated whenever the filter changes.
	const FILTER_OPTIONS = computed<FilterOption[]>(() => [
		{
			label: __('All'),
			icon: Mails,
			onClick: () => setFilter(null),
			selected: filter.value === null,
		},
		{
			label: __('Unread'),
			icon: MailIcon,
			onClick: () => setFilter('unread'),
			selected: filter.value === 'unread',
		},
		{
			label: __('Starred'),
			icon: Star,
			onClick: () => setFilter('starred'),
			condition: starrable,
			selected: filter.value === 'starred',
		},
		{
			label: __('Has attachments'),
			icon: Paperclip,
			onClick: () => setFilter('has_attachments'),
			selected: filter.value === 'has_attachments',
		},
	])

	/** What the toolbar's filter selector reads. Callers may show something else instead — a
	 *  selection count, a result count — but this is the filter's own name for itself. */
	const filterTitle = computed(() => {
		switch (filter.value) {
			case 'unread':
				return __('Unread Mails')
			case 'starred':
				return __('Starred Mails')
			case 'has_attachments':
				return __('With Attachments')
			default:
				return __('All Mails')
		}
	})

	return { filter, setFilter, reloadFilter, FILTER_OPTIONS, filterTitle }
}
