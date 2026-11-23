import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useOpenedKey } from './openedKey'

it('changes the key once the dialog around the element has finished opening', async () => {
  let finish = () => {}
  const opening = new Promise<void>((resolve) => (finish = resolve))
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.getAnimations = () => [fromPartial<Animation>({ finished: opening })]
  const inside = dialog.appendChild(document.createElement('div'))
  const element = ref<Element | null>(null)
  const key = useOpenedKey(element)

  element.value = inside
  await nextTick()
  expect(key.value).toBe(0)

  finish()
  await vi.waitFor(() => expect(key.value).toBe(1))
})

it('keeps the key outside a dialog', async () => {
  const element = ref<Element | null>(null)
  const key = useOpenedKey(element)
  element.value = document.createElement('div')
  await nextTick()
  await Promise.resolve()
  expect(key.value).toBe(0)
})
