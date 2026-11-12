import { computed, shallowRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { confirm } from '@/platform/feedback'
import { translate } from '@/platform/translation'

import { discardCopy, downloadCopy, oldDraftCopy, savedAtLabel, type RecoveryCopy } from './copies'

/** A converted presentation's old draft on this device, shown until the person dismisses it (Q16). */
export function useOldDraft(session: DocumentSession) {
  const copy = shallowRef<RecoveryCopy | null>(null)
  const oldDraftNotice = computed(
    () =>
      copy.value && translate('This device has unsaved work from {0}', [savedAtLabel(copy.value)]),
  )

  async function settleOldDraft() {
    copy.value = await oldDraftCopy(session.contentDocname, session.nodeId, session.title.value)
  }

  function downloadOldDraft() {
    if (copy.value) {
      downloadCopy({ ...copy.value, title: session.title.value })
    }
  }

  async function dismissOldDraft() {
    const kept = copy.value
    if (!kept) {
      return
    }

    const isConfirmed = await confirm({
      title: 'Discard recovery copy?',
      message: "This deletes the copy from this device. It can't be brought back.",
      confirmLabel: 'Discard',
      destructive: true,
    })
    if (!isConfirmed) {
      return
    }

    await discardCopy(kept)
    copy.value = null
  }

  return { oldDraftNotice, settleOldDraft, downloadOldDraft, dismissOldDraft }
}
