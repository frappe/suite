import { PluginKey } from '@tiptap/pm/state'
import { call } from 'frappe-ui'
import { createSuggestionExtension } from 'frappe-ui/experimental'
import type { BaseSuggestionItem } from 'frappe-ui'

import MentionList from '@/apps/mail/components/Controls/MentionList.vue'

// Same shape as a draft recipient, so a picked mention can be added to To as-is.
export interface MentionCandidate extends BaseSuggestionItem {
	email: string
	display_name?: string
	image?: string
}

type EmailSuggestion = { email: string; name?: string | null; user_image?: string }

const SEARCH_DEBOUNCE = 200

// `@` searches the same index the To field's autocomplete does — the account's cached
// message addresses first, then contacts, then the server — rather than the site's user
// list, which on most installs is a handful of people who are not who you write to.
const createContactSearch = (account: () => string) => {
	let pending: ReturnType<typeof setTimeout> | undefined
	let latest = 0

	// The suggester asks on every keystroke and each ask is a round trip, so the search
	// is debounced. Only the newest query is allowed to resolve: an earlier answer
	// arriving late would repaint the list under a query the user has already moved past.
	return (text: string) =>
		new Promise<MentionCandidate[]>((resolve) => {
			if (pending) clearTimeout(pending)
			if (!text) return resolve([])

			const query = ++latest
			pending = setTimeout(async () => {
				let suggestions: EmailSuggestion[] = []
				try {
					suggestions = await call('suite.mail.api.mail.get_email_suggestions', {
						account: account(),
						text,
					})
				} catch {
					// A failed search is an empty dropdown, not a broken composer.
				}

				if (query !== latest) return
				resolve(
					suggestions.map((suggestion) => ({
						email: suggestion.email,
						display_name: suggestion.name || undefined,
						image: suggestion.user_image,
					})),
				)
			}, SEARCH_DEBOUNCE)
		})
}

// The `@` suggester. Pairs with frappe-ui's Mention extension, which contributes the
// inline node this inserts (and stays inert on its own, having no item source).
export const createMentionSuggestion = ({
	account,
	onSelect,
	container,
}: {
	account: () => string
	onSelect: (contact: MentionCandidate) => void
	container?: () => HTMLElement | null
}) => {
	const search = createContactSearch(account)

	return createSuggestionExtension<MentionCandidate>({
		name: 'mailMentionSuggestion',
		char: '@',
		pluginKey: new PluginKey('mailMentionSuggestion'),
		component: MentionList,
		items: ({ query }) => search(query),
		command: ({ editor, range, props }) => {
			editor
				.chain()
				.focus()
				.insertContentAt(range, [
					{
						type: 'mention',
						attrs: { id: props.email, label: props.display_name || props.email },
					},
					{ type: 'text', text: ' ' },
				])
				.run()

			onSelect(props)
		},
		allowSpaces: false,
		decorationTag: 'span',
		decorationClass: 'mention-suggestion-active',
		tippyOptions: {
			placement: 'bottom-start',
			offset: [0, 8],
			// The popup defaults into <body>, which is where a modal composer's dialog
			// parks `pointer-events: none` on everything but itself: the list renders and
			// highlights on hover, but the press lands on the layer underneath, moves the
			// selection off the `@`, and the suggester tears the list down. Rendering it
			// inside the dialog keeps it in the interactive layer.
			appendTo: () => container?.() ?? document.body,
		},
	})
}
