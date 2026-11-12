import { defineComponent, h } from 'vue'

import type { DocumentTypeDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

const DrawIcon = defineComponent({
  name: 'DrawDocumentIcon',
  setup: () => () =>
    h(
      'svg',
      {
        class: 'size-4',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.5,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      [
        h('rect', {
          x: 3.5,
          y: 3.5,
          width: 17,
          height: 17,
          rx: 2.5,
        }),
        h('path', { d: 'M8.5 16c1.7-4.8 3.4-7.5 4.8-7.5 2 0 .7 4.8 0 6.5-.3 1 1 1 2.4-.3' }),
      ],
    ),
})

export const drawDocument: DocumentTypeDefinition = {
  key: 'draw',
  contentDoctype: 'Drawing',
  newLabel: () => __('Drawing'),
  icon: DrawIcon,
  loadSurface: async () => (await import('./surface/DrawSurface.vue')).default,
}
