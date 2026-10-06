import { computed, ref, type Component } from 'vue'
import {
	Inbox,
	Info,
	Mail as MailIcon,
	Mails,
	MessagesSquare,
	Paperclip,
	Star,
	Tag,
	Users,
} from 'lucide-vue-next'

import { userStore } from '@/apps/mail/stores/user'

/** One entry of the filter menu — what the toolbar hands to Dropdown/AdaptiveDropdown. */
export interface FilterOption {
	label: string
	icon: Component
	onClick: () => void
	selected: boolean
	condition?: () => boolean
}

/** A run of entries the menu draws under a heading of their own. */
export interface FilterGroup {
	group: string
	options: FilterOption[]
}

export type FilterOptions = (FilterOption | FilterGroup)[]

// The categories mail is sorted into as it is first fetched (suite.mail.classification). A list is
// filtered to one by the keyword that marks a message as being in it. Labels are functions: the
// translations are not loaded yet when this module is.
const CATEGORIES = [
	{ keyword: 'category_primary', label: () => __('Primary'), icon: Inbox },
	{ keyword: 'category_promotions', label: () => __('Promotions'), icon: Tag },
	{ keyword: 'category_social', label: () => __('Social'), icon: Users },
	{ keyword: 'category_updates', label: () => __('Updates'), icon: Info },
	{ keyword: 'category_forums', label: () => __('Forums'), icon: MessagesSquare },
]

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
	/**
	 * Whether the categories are offered. Off inside Sent, Drafts, Junk and Trash, whose mail is
	 * never given one.
	 */
	categorizable?: () => boolean
}

/**
 * The list filter — All / Unread / Starred / Has attachments, or one of the categories — remembered
 * per list, its menu, and the title the toolbar shows for it. All three were duplicated verbatim between the mailbox list and the
 * merged All Inboxes list, down to the localStorage key's shape.
 */
export const useStoredFilter = ({
	scope,
	onChange,
	starrable = () => true,
	categorizable = () => true,
}: StoredFilterOptions) => {
	const { userResource } = userStore()

	// Only on a site that classifies its mail: elsewhere no message carries a category.
	const categorized = () => !!userResource.data?.email_classification && categorizable()

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
	const FILTER_OPTIONS = computed<FilterOptions>(() => [
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
		{
			group: __('Categories'),
			options: CATEGORIES.map(({ keyword, label, icon }) => ({
				label: label(),
				icon,
				onClick: () => setFilter(keyword),
				condition: categorized,
				selected: filter.value === keyword,
			})),
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
			default: {
				const category = CATEGORIES.find(({ keyword }) => keyword === filter.value)
				return category ? category.label() : __('All Mails')
			}
		}
	})

	return { filter, setFilter, reloadFilter, FILTER_OPTIONS, filterTitle }
}
