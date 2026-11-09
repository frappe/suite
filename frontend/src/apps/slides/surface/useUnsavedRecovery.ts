import { toast } from 'frappe-ui'
import { computed, readonly, ref, shallowRef, watch } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { showsSlides, viewOnly } from '@/apps/slides/stores/presentation'
import {
  dirty,
  isSaving,
  resumeWrites,
  retireDraft,
  saveFailed,
  saveRefused,
  savingFor,
  stopWrites,
} from '@/apps/slides/stores/saving'
import { slides } from '@/apps/slides/stores/slide'
import { translate } from '@/platform/translation'

import {
  clearStaleRecovery,
  downloadRecovery,
  downloadSlides,
  forgetRecovery,
  keepOutlivedRecovery,
  keepRecovery,
  readRecovery,
  removeNewestRecovery,
} from './recovery'

interface RecoveryHost {
  isWritable: () => boolean
  isEditable: () => boolean
  load: () => Promise<void>
  cancelRunningLoad: () => void
}

/** The state that holds the surface until the person reloads or downloads. */
interface HeldNotice {
  message: string
  reload?: () => void
}

/** What happens to unsaved edits when the server refuses them or access changes. */
export function useUnsavedRecovery(
  session: DocumentSession,
  { isWritable, isEditable, load, cancelRunningLoad }: RecoveryHost,
) {
  const hasRecovery = ref(readRecovery(session.nodeId).length > 0)
  // access narrowed and no copy could be stored: the slides on screen are the only copy
  const isOnlyCopy = ref(false)
  const onlyCopyNotice = shallowRef<HeldNotice>()
  const refusalNotice = shallowRef<HeldNotice>()
  const heldNotice = computed(() => onlyCopyNotice.value ?? refusalNotice.value)
  // in the hold, or as the only copy, the live slides can go out with nothing stored
  const canDownloadChanges = computed(
    () => hasRecovery.value || saveRefused.value || isOnlyCopy.value,
  )

  function narrowed() {
    // First, so no snapshot and no push leaves after this point. `stopWrites`
    // also cancels a save under way and retires the draft, so it never replays,
    // unless no copy of an unread draft fits or the store refuses both ways of
    // retiring it: that one stays for the next load
    // with no slides on screen yet there is nothing of the screen's to keep, whatever the flags say
    const unsaved =
      !!slides.value?.length &&
      (dirty.value || isSaving.value || saveFailed.value || isOnlyCopy.value)
    viewOnly.value = true
    if (!unsaved) {
      void stopWrites(session.contentDocname, keepUnreadDraft)
      toast.warning('Editing access changed. This presentation is now view only.')
      return
    }

    void stopWrites(session.contentDocname)
    isOnlyCopy.value = !retainRecovery()

    if (isOnlyCopy.value) {
      cancelRunningLoad()
      showOnlyCopy(translate('Editing access changed. Download your changes before you reload.'))
      return
    }

    showKept('Editing access changed. Your unsaved changes are kept on this device.')
  }

  function widened() {
    if (isOnlyCopy.value && !retainRecovery()) {
      showAccessBack()
      return
    }

    isOnlyCopy.value = false
    loadAfterAccessBack()
  }

  let hasSettledCopies = false

  // A save that lands with edit access makes the recovery copy stale
  watch(savingFor, (now, before) => {
    // a push of the presentation left behind says nothing about this one
    if (now || before !== session.contentDocname) return

    if (saveFailed.value || !isEditable() || !hasRecovery.value) return

    // the last surface's push can land during this one's first load
    if (!hasSettledCopies) return

    clearStaleRecovery(session.nodeId)
    syncHasRecovery()
  })

  watch(saveRefused, (isRefused) => {
    if (isRefused) {
      showRefusal()
    } else {
      refusalNotice.value = undefined
    }
  })
  watch(isOnlyCopy, (isOnly) => {
    if (!isOnly) {
      onlyCopyNotice.value = undefined
    }
  })
  function retainRecovery() {
    if (!slides.value?.length) {
      return true
    }

    try {
      // with writes stopped no draft holds these slides, so a landed save can't make them stale
      keepRecovery(session.nodeId, liveSlides(), {
        sticky: !isWritable() || isOnlyCopy.value,
      })
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

  /** Keeps the slides as they are now, past any later save. */
  function retainSticky() {
    try {
      keepSticky(liveSlides())
      return true
    } catch {
      return false
    }
  }

  // a draft from a killed tab that the first load had not reached when access narrowed
  function keepUnreadDraft(content: unknown[]) {
    try {
      keepSticky(content)
    } catch {
      return false
    }

    showKept(
      translate('Editing access changed. Unsaved changes from earlier are kept on this device.'),
    )
    return true
  }

  function showKept(message: string) {
    toast.warning(message, {
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'Download my changes',
        onClick: downloadChanges,
      },
    })
  }

  function retainOrWarn() {
    const isKept = retainRecovery()
    if (!isKept) {
      toast.error('Your latest changes could not be kept on this device.')
    }

    return isKept
  }

  // the server copy is the truth now: reload it rather than replay anything,
  // though a dirty draft left for lack of room loads like any other
  function loadAfterAccessBack() {
    resumeWrites(session.contentDocname)
    toast.info('You can edit this presentation again.')
    void load()
  }

  function showAccessBack() {
    showOnlyCopy(
      translate('Editing access is back. Download your changes before you reload.'),
      reloadAfterAccessBack,
    )
  }

  function reloadAfterAccessBack() {
    const isSafe =
      retainRecovery() ||
      window.confirm(
        translate('Your latest changes could not be kept on this device. Reload anyway?'),
      )
    if (!isSafe) {
      return
    }

    loadAfterAccessBack()
  }

  function syncHasRecovery() {
    hasRecovery.value = readRecovery(session.nodeId).length > 0
  }

  function liveSlides() {
    const copy: unknown = JSON.parse(JSON.stringify(slides.value))
    if (!Array.isArray(copy)) throw new Error('Live presentation copy must be an array')
    return copy
  }

  function showRefusal() {
    let message = translate(
      'This presentation changed elsewhere. Your changes are kept on this device.',
    )
    try {
      keepSticky(liveSlides())
    } catch {
      message = translate(
        'This presentation changed elsewhere. Download your changes before you reload.',
      )
    }

    refusalNotice.value = { message, reload: () => void load() }
  }

  function showOnlyCopy(message: string, reload?: () => void) {
    onlyCopyNotice.value = { message, reload }
    // its "kept" and its bare Reload no longer hold
    refusalNotice.value = undefined
  }

  function downloadChanges() {
    const title = session.title.value
    if (saveRefused.value || isOnlyCopy.value) {
      downloadSlides(liveSlides(), title)
      return
    }

    if (!downloadRecovery(session.nodeId, title)) {
      syncHasRecovery()
      toast.error('No recovery copy is kept for this presentation.')
    }
  }

  async function discardChanges() {
    if (!window.confirm(translate("Discard your kept changes? This can't be undone."))) {
      return
    }

    if (saveRefused.value) {
      forgetRecovery(session.nodeId, liveSlides())
      syncHasRecovery()
      await retireDraft(session.contentDocname)
      if (isWritable()) {
        resumeWrites(session.contentDocname)
      }

      await load()
      return
    }

    if (isOnlyCopy.value) {
      if (isWritable()) {
        resumeWrites(session.contentDocname)
      }

      await load()
      return
    }

    removeNewestRecovery(session.nodeId)
    syncHasRecovery()
    // the edits on screen would go into a copy again on leaving
    if (!isWritable()) {
      await load()
    }
  }

  // the server copy replaced the slides on screen
  function clearOnlyCopy() {
    isOnlyCopy.value = false
  }

  function settleCopies() {
    if (hasSettledCopies) {
      return
    }

    hasSettledCopies = true
    keepOutlivedRecovery(session.nodeId, showsSlides)
  }

  return {
    isOnlyCopy: readonly(isOnlyCopy),
    clearOnlyCopy,
    canDownloadChanges,
    narrowed,
    widened,
    keepSticky,
    retainRecovery,
    retainSticky,
    retainOrWarn,
    reloadAfterAccessBack,
    downloadChanges,
    discardChanges,
    settleCopies,
    heldNotice,
  }
}
