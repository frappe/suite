import { defineComponent, h } from 'vue'

import type { DocumentTypeDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

const SlidesIcon = defineComponent({
  name: 'SlidesDocumentIcon',
  setup: () => () =>
    h('span', {
      class: 'lucide-presentation size-4',
      'aria-hidden': 'true',
    }),
})

export const slidesDocument: DocumentTypeDefinition = {
  key: 'slides',
  contentDoctype: 'Presentation',
  newLabel: () => __('Presentation'),
  icon: SlidesIcon,
  loadSurface: async () => (await import('@/apps/slides/surface/SlidesSurface.vue')).default,
}
