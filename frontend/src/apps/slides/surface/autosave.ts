/**
 * Autosave for the Slides surface (specs/slides/001-saving.md).
 *
 * A 1 second poll saves a dirty deck whatever slide is selected. During a drag
 * or resize only the local copy is written, so the server never receives every
 * intermediate position. A page going away writes the local copy, which the next
 * open restores.
 */
import { onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue'

import { dirty, saveChanges, saveDraft } from '@/apps/slides/stores/saving'

export const AUTOSAVE_INTERVAL_MS = 1_000

interface AutosaveOptions {
  editable: MaybeRefOrGetter<boolean>
  interacting: MaybeRefOrGetter<boolean>
}

export function useAutosave(options: AutosaveOptions): void {
  const timer = window.setInterval(() => {
    if (!toValue(options.editable) || !dirty.value) return
    void (toValue(options.interacting) ? saveDraft() : saveChanges())
  }, AUTOSAVE_INTERVAL_MS)

  // `pagehide` fires where `beforeunload` does not, such as a phone closing the tab.
  function keepDraft() {
    if (toValue(options.editable) && dirty.value) void saveDraft()
  }

  window.addEventListener('pagehide', keepDraft)
  onScopeDispose(() => {
    window.clearInterval(timer)
    window.removeEventListener('pagehide', keepDraft)
  })
}
