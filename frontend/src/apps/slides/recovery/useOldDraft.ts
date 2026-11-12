import { computed, shallowRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { confirm } from '@/platform/feedback'
import { translate } from '@/platform/translation'

import {
  discardCopy,
  downloadCopy,
  oldDraftCopies,
  savedAtLabel,
  type RecoveryCopy,
} from './copies'

/**
 * A converted presentation's old drafts on this device, the newest shown until the person
 * dismisses it, then the next (Q16).
 */
export function useOldDraft(session: DocumentSession, { isEditor }: { isEditor: () => boolean }) {
  const copy = shallowRef<RecoveryCopy | null>(null)
  const oldDraftNotice = computed(
    () =>
      copy.value && translate('This device has unsaved work from {0}', [savedAtLabel(copy.value)]),
  )

  async function settleOldDraft() {
    const copies = await oldDraftCopies(
      session.contentDocname,
      session.nodeId,
      session.title.value,
      { isEditor: isEditor() },
    )
    copy.value = copies[0] ?? null
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
    // a newer draft another tab wrote meanwhile stays, and shows in its place
    await settleOldDraft()
  }

  return { oldDraftNotice, settleOldDraft, downloadOldDraft, dismissOldDraft }
}
