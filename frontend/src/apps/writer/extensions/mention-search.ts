import { Extension } from '@tiptap/core'

/** The text typed after an `@` that starts a word, up to the cursor. */
const MENTION_QUERY = /(?:^|[\s(])@([^\s@]*)$/

/**
 * Reports what the user has typed after `@`, so the menu can ask the server.
 * frappe-ui's mention menu filters a ready list and never passes the query on.
 * Call `onQuery` with `''` when the cursor is not in a mention.
 */
export const MentionSearch = Extension.create<{ onQuery: (query: string) => void }>({
  name: 'mentionSearch',

  addOptions() {
    return { onQuery: () => {} }
  },

  onTransaction() {
    const { $from, empty } = this.editor.state.selection
    if (!empty) return
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    const match = MENTION_QUERY.exec(before)
    if (match) this.options.onQuery(match[1] ?? '')
  },
})
