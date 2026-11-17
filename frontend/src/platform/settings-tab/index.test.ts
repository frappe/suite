import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import { SettingsForm, useSettingsSelection } from '@/platform/settings-tab'
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

describe('a settings list selection', () => {
  it('selects rows one at a time or all at once, and acts only on rows still listed', () => {
    const rows = ref(['a@x.test', 'b@x.test', 'c@x.test'])
    const selection = useSettingsSelection(() => rows.value)

    selection.row('c@x.test')['onUpdate:selected'](true)
    selection.row('a@x.test')['onUpdate:selected'](true)
    expect(selection.selected).toEqual(['a@x.test', 'c@x.test'])
    expect(selection.row('b@x.test')).toMatchObject({ selected: false, selecting: true })

    // A search hides a selected row: it is no longer part of what a bulk action reaches.
    rows.value = ['a@x.test', 'b@x.test']
    expect(selection.selected).toEqual(['a@x.test'])

    selection.toggleAll()
    expect(selection.all).toBe(true)
    expect(selection.count).toBe(2)
    selection.toggleAll()
    expect(selection.count).toBe(0)
    expect(selection.row('a@x.test')).toMatchObject({ selected: false, selecting: false })
  })
})
