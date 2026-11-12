import { toast } from 'frappe-ui'
import { computed, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { viewOnly } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import type { LostAccess } from '@/platform/collab'
import { translate } from '@/platform/translation'

import {
  downloadRecovery,
  downloadSlides,
  keepOutlivedRecovery,
  keepRecovery,
  readRecovery,
  removeNewestRecovery,
} from './recovery'

export interface RetainOptions {
  /** Past any later copy. By default only once edit access has gone. */
  sticky?: boolean
}

interface RecoveryHost {
  isWritable: () => boolean
  isReadable: () => boolean
  load: () => Promise<void>
  /** Shuts the live room for the lost right. True if it still holds unsent work. */
  loseAccess: (lost: LostAccess) => Promise<boolean>
  /** Asks the live room to take edits again: `held` when reloading would drop unsent work. */
  regainAccess: () => Promise<'editing' | 'reload' | 'held'>
}

/** What happens to unsent edits when access changes or the page goes away. */
export function useUnsavedRecovery(
  session: DocumentSession,
  { isWritable, isReadable, load, loseAccess, regainAccess }: RecoveryHost,
) {
  const hasRecovery = ref(readRecovery(session.nodeId).length > 0)
  const canDownloadChanges = computed(() => hasRecovery.value)
  let hasSettledCopies = false

  async function narrowed() {
    viewOnly.value = true
    const shown = liveSlides()
    const title = session.title.value
    const isUnsent = await loseAccess(isReadable() ? 'lost_edit' : 'lost_read')
    if (!isUnsent) {
      // Access came back within the bound, so nothing turned view only
      if (!isWritable()) {
        toast.warning('Editing access changed. This presentation is now view only.')
      }

      return
    }

    toast.warning('Editing access changed. Your unsaved changes are kept on this device.', {
      duration: Number.POSITIVE_INFINITY,
      action: { label: 'Download my changes', onClick: () => downloadSlides(shown, title) },
    })
  }

  async function widened() {
    const regained = await regainAccess()
    if (regained === 'held') {
      return
    }

    toast.info('You can edit this presentation again.')
    if (regained === 'reload') {
      void load()
    }
  }

  function retainRecovery({ sticky = !isWritable() }: RetainOptions = {}) {
    if (!slides.value?.length) {
      return true
    }

    try {
      keepRecovery(session.nodeId, liveSlides(), { sticky })
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

  /** Once, as the open first draws the presentation: an earlier page's different copy stays. */
  function settleCopies() {
    if (hasSettledCopies) {
      return
    }

    hasSettledCopies = true
    keepOutlivedRecovery(session.nodeId, liveSlides())
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
    settleCopies,
    downloadChanges,
    discardChanges,
  }
}
