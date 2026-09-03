import { h } from 'vue'
import { Avatar } from 'frappe-ui'
import { Check } from 'lucide-vue-next'

interface Account {
	id: string
	_name: string
}

/**
 * The rows of the sidebar's account list.
 *
 * Mail and calendar show the same accounts, so they should say the same things
 * about them — which is exactly what stopped being true once each app built its
 * own rows: one grew an avatar and a tick, the other marked the current account
 * by filling its row instead. Written once here so they cannot drift again.
 *
 * What legitimately differs between the two is only where picking an account
 * takes you, so that is the one thing passed in.
 *
 * The row itself is the menu's own — avatar where an icon goes, name as the
 * label, tick as a suffix. Standing in for the whole row with a custom `item`
 * slot means re-declaring the padding, hover and truncation it already has, and
 * costs the row its element on every render.
 */
export const accountSubmenu = (
	accounts: Account[] | undefined,
	activeId: string | undefined,
	onSelect: (id: string) => void,
) =>
	(accounts ?? []).map((account) => ({
		label: account._name,
		onClick: () => onSelect(account.id),
		slots: {
			prefix: () => h(Avatar, { label: account._name, size: 'md' }),
			suffix: () =>
				account.id === activeId
					? h(Check, { class: 'icon size-4 shrink-0 text-ink-gray-7' })
					: null,
		},
	}))
