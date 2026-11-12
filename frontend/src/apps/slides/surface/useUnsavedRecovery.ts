import { toast } from 'frappe-ui'
import { computed, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { viewOnly } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { translate } from '@/platform/translation'

import {
  downloadRecovery,
  downloadSlides,
  keepRecovery,
  readRecovery,
  removeNewestRecovery,
} from './recovery'

interface RecoveryHost {
  isWritable: () => boolean
  load: () => Promise<void>
}

/** What happens to unsent edits when access changes or the page goes away. */
export function useUnsavedRecovery(session: DocumentSession, { isWritable, load }: RecoveryHost) {
  const hasRecovery = ref(readRecovery(session.nodeId).length > 0)
  const canDownloadChanges = computed(() => hasRecovery.value)

  function narrowed() {
    viewOnly.value = true
    toast.warning('Editing access changed. This presentation is now view only.')
  }

  function widened() {
    toast.info('You can edit this presentation again.')
    void load()
  }

  function retainRecovery() {
    if (!slides.value?.length) {
      return true
    }

    try {
      keepRecovery(session.nodeId, liveSlides(), { sticky: !isWritable() })
      hasRecovery.value = true
      return true
    } catch {
      return false
    }
  }

  function keepSticky(content: unknown[]) {
    keepRecovery(session.nodeId, content, { sticky: true })
    hasRecovery.value = true
  }

  /** Keeps the slides as they are now, past any later copy. With no room, offers them as a download. */
  function retainStickyOrOffer() {
    const copy = liveSlides()
    try {
      keepSticky(copy)
      return true
    } catch {
      const title = session.title.value
      toast.error(translate('Your latest changes could not be kept on this device.'), {
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: 'Download my changes',
          onClick: () => downloadSlides(copy, title),
        },
      })
      return false
    }
  }

  function retainOrWarn() {
    const isKept = retainRecovery()
    if (!isKept) {
      toast.error('Your latest changes could not be kept on this device.')
    }

    return isKept
  }

  function syncHasRecovery() {
    hasRecovery.value = readRecovery(session.nodeId).length > 0
  }

  function liveSlides() {
    const copy: unknown = JSON.parse(JSON.stringify(slides.value))
    if (!Array.isArray(copy)) throw new Error('Live presentation copy must be an array')
    return copy
  }

  function downloadChanges() {
    if (!downloadRecovery(session.nodeId, session.title.value)) {
      syncHasRecovery()
      toast.error('No recovery copy is kept for this presentation.')
    }
  }

  async function discardChanges() {
    if (!window.confirm(translate("Discard your kept changes? This can't be undone."))) {
      return
    }

    removeNewestRecovery(session.nodeId)
    syncHasRecovery()
    // the edits on screen would go into a copy again on leaving
    if (!isWritable()) {
      await load()
    }
  }

  return {
    canDownloadChanges,
    narrowed,
    widened,
    retainRecovery,
    retainStickyOrOffer,
    retainOrWarn,
    downloadChanges,
    discardChanges,
  }
}
