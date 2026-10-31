import { computed, onScopeDispose, shallowRef } from 'vue'

/**
 * The open area's keyboard shortcuts list. Each area draws its own dialog, so
 * its layout registers how to open it while mounted, and the shell's rail
 * opens it without importing the area.
 */
const openers = shallowRef<readonly (() => void)[]>([])

/** Registers the area's dialog opener until the calling scope is disposed. */
export function provideAreaShortcuts(open: () => void): void {
  openers.value = [...openers.value, open]
  onScopeDispose(() => {
    openers.value = openers.value.filter((opener) => opener !== open)
  })
}

/** Whether the area on screen has a shortcuts list. */
export const hasAreaShortcuts = computed(() => openers.value.length > 0)

/** Opens the shortcuts list of the area mounted last. */
export function openAreaShortcuts(): void {
  openers.value.at(-1)?.()
}
