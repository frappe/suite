import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import { SettingsForm } from '@/platform/settings-tab'
import { translationPlugin } from '@/platform/translation'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

function mountForm(save: () => Promise<unknown>) {
  const name = ref('Maya')
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(SettingsForm, { dirty: name.value !== 'Maya', save }, () =>
        h('input', {
          'aria-label': 'First name',
          value: name.value,
          onInput: (event: Event) => {
            if (event.target instanceof HTMLInputElement) name.value = event.target.value
          },
        }),
      ),
  })
  app.use(translationPlugin)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  const field = root.querySelector<HTMLInputElement>('input[aria-label="First name"]')!
  // frappe-ui's Button is stubbed in tests; the form's only button is Save.
  const button = () => root.querySelector<HTMLButtonElement>('button[type="submit"]')!
  return { field, button }
}

async function type(field: HTMLInputElement, value: string) {
  field.value = value
  field.dispatchEvent(new Event('input'))
  await vi.waitFor(() => expect(field.value).toBe(value))
}

describe('a settings form', () => {
  it('keeps Save off until a field changes, and saves once while the save is pending', async () => {
    let finish: () => void = () => {}
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const { field, button } = mountForm(save)

    expect(button().disabled).toBe(true)
    button().click()
    expect(save).not.toHaveBeenCalled()

    await type(field, 'Maia')
    await vi.waitFor(() => expect(button().disabled).toBe(false))
    button().click()
    button().click()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    finish()
    await type(field, 'Maya')
    await vi.waitFor(() => expect(button().disabled).toBe(true))
  })
})
