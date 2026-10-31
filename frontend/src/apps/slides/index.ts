import { defineComponent, h } from 'vue'

import { router } from '@/apps/slides/router'
import { trackLoadedAssets } from '@/apps/slides/utils/loadedAssets'
import { claimSlidesCachesFor } from '@/apps/slides/utils/serviceWorker'
import type { DocumentTypeDefinition } from '@/platform/contracts'
import { getCookieSessionUser } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

// before any page reads slides data, so another user arriving never sees the last one's
router.beforeEach(async () => {
  const user = getCookieSessionUser()

  if (user) {
    await claimSlidesCachesFor(user).catch(() => {})
  }
})

// from app start, so an offline copy can list every chunk the page loaded
trackLoadedAssets()

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
  forgetNode: (nodeId) => void forgetOfflineCopy(nodeId),
}

async function forgetOfflineCopy(nodeId: string) {
  try {
    const store = await import('@/apps/slides/stores/offlineCopy')
    await store.removeNodeOfflineCopy(nodeId)
  } catch {}
}
