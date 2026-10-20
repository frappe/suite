import { defineAsyncComponent, defineComponent, h } from 'vue'

import type { DocumentTypeDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

const WriterIcon = defineComponent({
  name: 'WriterDocumentIcon',
  setup: () => () =>
    h('span', {
      class: 'lucide-file-text size-4',
      'aria-hidden': 'true',
    }),
})

export const writerDocument: DocumentTypeDefinition = {
  key: 'writer',
  contentDoctype: 'Writer Document',
  newLabel: () => __('Document'),
  icon: WriterIcon,
  loadSurface: async () => (await import('@/apps/writer/surface/WriterSurface.vue')).default,
  loadUnsavedWork: async () => (await import('@/apps/writer/recovery/UnsavedWork.vue')).default,
  listUnsavedCopies: async () => (await import('@/apps/writer/recovery/copies')).copyEntries(),
}

/** A comment box where `@` picks a person; it writes the `@[user]` mentions Drive notifies. */
export const WriterMentionTextarea = defineAsyncComponent(
  () => import('@/apps/writer/surface/MentionTextarea.vue'),
)

/** A comment's text, with the people it mentions shown by name. */
export const WriterCommentText = defineAsyncComponent(
  () => import('@/apps/writer/surface/CommentText.vue'),
)
