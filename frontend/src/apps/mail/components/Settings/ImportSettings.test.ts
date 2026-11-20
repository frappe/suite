import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import ImportSettings from './ImportSettings.vue'

type Tab = { label: string; value: string }
vi.mock('frappe-ui', () => ({
  // Each tab is a button that picks it
  TabButtons: defineComponent(
    (props: { options?: Tab[] }, { emit }) =>
      () =>
        props.options?.map((tab) =>
          h('button', { onClick: () => emit('update:modelValue', tab.value) }, tab.label),
        ),
    { props: ['options'], emits: ['update:modelValue'] },
  ),
}))
// A form says whether its buttons are the dialog's
function form(name: string) {
  return {
    default: defineComponent({
      props: { isActive: Boolean },
      setup: (props) => () => h('form', { 'data-form': name, 'data-active': props.isActive }),
    }),
  }
}

vi.mock('./MailImportSettings.vue', () => form('mail'))
vi.mock('./ContactsImportSettings.vue', () => form('contacts'))

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(ImportSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  return root
}

/** The forms whose buttons the dialog shows. */
function active(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-active="true"]')).map(
    (shown) => shown.dataset.form,
  )
}

afterEach(() => app.unmount())

it('gives the dialog the buttons of the tab on show, and of no other', async () => {
  window.__ = (text: string) => text
  const root = mount()
  expect(root.querySelectorAll('form')).toHaveLength(2)
  expect(active(root)).toEqual(['mail'])

  const contacts = Array.from(root.querySelectorAll('button')).find(
    (button) => button.textContent === 'Contacts',
  )
  requireTestElement(contacts, HTMLButtonElement).click()
  await nextTick()
  expect(active(root)).toEqual(['contacts'])
})
