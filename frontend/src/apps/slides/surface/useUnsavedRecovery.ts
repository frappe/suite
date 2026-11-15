import { toast } from 'frappe-ui'
import { computed, ref, shallowRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import {
  discardCopy,
  downloadCopy,
  roomCopies,
  type RecoveryCopy,
} from '@/apps/slides/recovery/copies'
import { viewOnly } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import type { LostAccess } from '@/platform/collab'
import { translate } from '@/platform/translation'

import {
  discardRecovery,
  downloadRecovery,
  downloadSlides,
  keepRecovery,
  newestRecovery,
  readRecovery,
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
  /** Whether the live room kept its unsent work as a copy on the device itself. */
  isKeptByRoom: () => boolean
}

/** What happens to unsent edits when access changes or the page goes away. */
export function useUnsavedRecovery(
  session: DocumentSession,
  { isWritable, isReadable, load, loseAccess, regainAccess, isKeptByRoom }: RecoveryHost,
) {
  const hasRecovery = ref(readRecovery(session.nodeId).length > 0)
  // What the live room kept on the device, newest first: this page keeps no second copy of it
  const roomKept = shallowRef<RecoveryCopy[]>([])
  const canDownloadChanges = computed(() => hasRecovery.value || roomKept.value.length > 0)
  void syncRoomKept()

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
    if (!slides.value?.length || isKeptByRoom()) {
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

  function syncHasRecovery() {
    hasRecovery.value = readRecovery(session.nodeId).length > 0
  }

  /** Reads again what the live room kept, as it keeps a copy or one is discarded. */
  async function syncRoomKept() {
    roomKept.value = await roomCopies(session.nodeId)
  }

  // The room's newest copy, where no page copy is newer
  function newerRoomCopy() {
    const kept = roomKept.value[0]
    const page = newestRecovery(session.nodeId)
    const isNewer = !!kept && (!page || kept.savedAt.getTime() >= Date.parse(page.copy.savedAt))
    return isNewer ? kept : undefined
  }

  function liveSlides() {
    const copy: unknown = JSON.parse(JSON.stringify(slides.value))
    if (!Array.isArray(copy)) throw new Error('Live presentation copy must be an array')
    return copy
  }

  function downloadChanges() {
    const kept = newerRoomCopy()
    if (kept) {
      downloadCopy({ ...kept, title: session.title.value })
      return
    }

    const downloaded = downloadRecovery(session.nodeId, session.title.value)
    if (downloaded === 'none') {
      syncHasRecovery()
      toast.error('No recovery copy is kept for this presentation.')
    } else if (downloaded === 'unmarked') {
      toast.warning(translate('This device is too full to note that the copy was downloaded.'))
    }
  }

  async function discardChanges() {
    // the copy as it is while the person is asked, so one another tab writes meanwhile stays
    const kept = newerRoomCopy()
    const shown = kept ? undefined : newestRecovery(session.nodeId)
    if (!window.confirm(translate("Discard your kept changes? This can't be undone."))) {
      return
    }

    try {
      if (kept) {
        await discardCopy(kept)
      } else if (shown) {
        discardRecovery(session.nodeId, shown.id, shown.copy)
      }
    } catch {
      toast.error(translate("Couldn't discard the copy. It's still kept on this device."))
      return
    }

    syncHasRecovery()
    await syncRoomKept()
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
    syncRoomKept,
    downloadChanges,
    discardChanges,
  }
}
