/**
 * Autosave for the Slides surface (specs/slides/001-saving.md).
 *
 * A 1 second poll saves a dirty deck whatever slide is selected. During a drag
 * or resize only the local copy is written, so the server never receives every
 * intermediate position. Closing or reloading the tab with unsaved edits asks
 * the browser to confirm and writes the local copy, which the next open restores.
 */
import { onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue'

import { dirty, saveChanges, saveDraft } from '@/apps/slides/stores/saving'

import type { DocumentSaveState } from './navigation'

export const AUTOSAVE_INTERVAL_MS = 1_000

interface AutosaveOptions {
  editable: MaybeRefOrGetter<boolean>
  interacting: MaybeRefOrGetter<boolean>
  state: () => DocumentSaveState
}

export function useAutosave(options: AutosaveOptions): void {
  const timer = window.setInterval(() => {
    if (!toValue(options.editable) || !dirty.value) return
    void (toValue(options.interacting) ? saveDraft() : saveChanges())
  }, AUTOSAVE_INTERVAL_MS)

  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (!toValue(options.editable) || options.state() === 'clean') return
    void saveDraft()
    event.preventDefault()
    // Older browsers show the prompt only when this is set.
    event.returnValue = ''
  }
  // `pagehide` also fires where `beforeunload` does not, such as a phone closing the tab.
  function keepDraft() {
    if (toValue(options.editable) && dirty.value) void saveDraft()
  }

  window.addEventListener('beforeunload', warnBeforeUnload)
  window.addEventListener('pagehide', keepDraft)
  onScopeDispose(() => {
    window.clearInterval(timer)
    window.removeEventListener('beforeunload', warnBeforeUnload)
    window.removeEventListener('pagehide', keepDraft)
  })
}
