import { SuggestionExtension } from 'frappe-ui/editor'

import { api, client, type OutputOf } from '@/api'
import MentionList from '@/apps/mail/components/Controls/MentionList.vue'

// Same shape as a draft recipient, so a picked mention can be added to To as-is.
export interface MentionCandidate {
  email: string
  display_name?: string
  image?: string
}

type EmailSuggestion = OutputOf<typeof api.mail.contacts.suggest>[number]

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
          suggestions = await client.query(api.mail.contacts.suggest, {
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
            image: suggestion.user_image ?? undefined,
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
}: {
  account: () => string
  onSelect: (contact: MentionCandidate) => void
}) => {
  const search = createContactSearch(account)

  return SuggestionExtension.configure<MentionCandidate>({
    name: 'mailMentionSuggestion',
    trigger: '@',
    listComponent: MentionList,
    items: search,
    command: ({ editor, range, item }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: 'mention',
            attrs: { id: item.email, label: item.display_name || item.email },
          },
          { type: 'text', text: ' ' },
        ])
        .run()

      onSelect(item)
    },
    allowSpaces: false,
    floatingOptions: { placement: 'bottom-start', offset: [0, 8] },
  })
}
