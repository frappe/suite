import { ref, watch, type Ref } from 'vue'

/**
 * A key that changes each time the dialog around `element` finishes opening.
 *
 * frappe-ui's TabButtons measures its selected tab once, when it mounts. In a
 * dialog that is during the zoom-in (scale 0.98 to 1), so the selected pill
 * came out 2% short of its tab and stayed so. Keying TabButtons on this draws
 * it again at full size.
 */
export function useOpenedKey(element: Readonly<Ref<Element | null | undefined>>): Ref<number> {
  const key = ref(0)
  watch(element, async (current) => {
    const dialog = current?.closest('[role="dialog"]')
    if (!dialog || typeof dialog.getAnimations !== 'function') return
    await Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished))
    key.value += 1
  })
  return key
}
