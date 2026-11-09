import type { Editor } from '@tiptap/core'
import { SuggestionExtension } from 'frappe-ui/editor'
import type { Component } from 'vue'

import type { WriterUser } from '@/apps/writer/drive'

/**
 * The `@` menu for an editor whose kit adds the `mention` node with no items. Its people come
 * from the server, ranked for the open document, so the menu asks for them itself and ignores
 * the plugin's items. The caller supplies the menu because this extension is in the server's
 * converter bundle, which must not load the API client the menu asks with.
 */
export const mentionMenuExtension = (listComponent: Component) =>
  SuggestionExtension.configure<WriterUser>({
    name: 'mentionMenu',
    trigger: '@',
    items: () => [],
    listComponent,
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
