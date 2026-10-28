import type { Editor } from '@tiptap/core'
import { SuggestionExtension } from 'frappe-ui/editor'

import MentionMenu from '@/apps/writer/components/MentionMenu.vue'
import type { WriterUser } from '@/apps/writer/drive'

/**
 * The `@` menu for an editor whose kit adds the `mention` node with no items. Its people come
 * from the server, ranked for the open document, so the menu asks for them itself and ignores
 * the plugin's items.
 */
export const MentionMenuExtension = SuggestionExtension.configure<WriterUser>({
  name: 'mentionMenu',
  trigger: '@',
  items: () => [],
  listComponent: MentionMenu,
  allowedPrefixes: [' ', ' ', '(', '[', '"', "'", '“', '‘'],
  floatingOptions: { placement: 'bottom-start', offset: [0, 8] },
  command: ({ editor, item, range }) => {
    const mention = { type: 'mention', attrs: { id: item.value, label: item.label } }
    editor
      .chain()
      .focus()
      .insertContentAt(range, [mention, { type: 'text', text: ' ' }])
      .run()
  },
}).extend({
  addOptions() {
    const options = this.parent?.()
    if (!options) throw new Error('The suggestion extension has no options')
    return {
      ...options,
      // An `@` in code is source, not a mention
      suggestion: {
        ...options.suggestion,
        allow: ({ editor }: { editor: Editor }) =>
          !editor.isActive('code') && !editor.isActive('codeBlock'),
      },
    }
  },
})
