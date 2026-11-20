import { useKeyboardShortcut } from 'frappe-ui'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'

import { translate as __ } from '@/platform/translation'

export { useKeySequences, type KeySequenceShortcut, type Letter } from './keySequences'
export { default as ShortcutsDialog } from './ShortcutsDialog.vue'
export { isMacPlatform } from './keycaps'

/**
 * The keyboard shortcuts list of the page on screen. An area that draws its own
 * dialog registers how to open it while mounted; everywhere else the shell's
 * dialog lists what the page registered. The rail opens either without
 * importing the area.
 */
const openers = shallowRef<readonly (() => void)[]>([])

/** Registers the area's dialog opener until the calling scope is disposed. */
export function provideAreaShortcuts(open: () => void): void {
  openers.value = [...openers.value, open]
  onScopeDispose(() => {
    openers.value = openers.value.filter((opener) => opener !== open)
  })
}

const hasAreaShortcuts = computed(() => openers.value.length > 0)

/** Whether the shell's shortcuts list is open. */
export const shellShortcutsOpen = ref(false)

/** Opens the shortcuts list of the area mounted last, or the shell's when no area has one. */
export function openAreaShortcuts(): void {
  const opener = openers.value.at(-1)
  if (opener) {
    opener()
  } else {
    shellShortcutsOpen.value = true
  }
}

/** The suite-wide `?`. An area with its own list binds its own, so this one steps aside there. */
export function useShortcutsKey(): void {
  useKeyboardShortcut({
    combo: 'Shift+Slash',
    description: __('View shortcuts'),
    group: 'Suite',
    enabled: () => !hasAreaShortcuts.value,
    preventDefault: false,
    handler: (event) => {
      // the page already took the key, as a Sheets cell does when `?` starts typing into it
      if (event.defaultPrevented) {
        return
      }

      event.preventDefault()
      openAreaShortcuts()
    },
  })
}
