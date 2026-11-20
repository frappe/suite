import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import SettingsFileField from './SettingsFileField.vue'

vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      return () => h('button', props.label)
    },
  }),
  ErrorMessage: defineComponent({
    props: { message: { type: String, default: undefined } },
    setup(props) {
      return () => props.message && h('p', { role: 'alert' }, props.message)
    },
  }),
  FormLabel: defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      return () => h('label', props.label)
    },
  }),
}))
vi.mock('@/platform/feedback', () => ({ failureText: (error: Error) => error.message }))

const upload = vi.fn<(file: File) => Promise<void>>()
let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(SettingsFileField, { label: 'File', upload })
  app.mount(root)
  return root
}

/** Picks a file of this name in the field's file picker, and waits for its upload to end. */
async function pick(root: HTMLElement, name: string) {
  const input = requireTestElement(root.querySelector('input[type="file"]'), HTMLInputElement)
  const file = new File(['mail'], name)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return file
}

beforeEach(() => {
  window.__ = (text: string) => text
  upload.mockReset().mockResolvedValue()
})
afterEach(() => app.unmount())

it('says no file is chosen until one is picked', () => {
  expect(mount().querySelector('span')?.textContent).toBe('No file chosen')
})
it('uploads the picked file and names it beside the button', async () => {
  const root = mount()
  const file = await pick(root, 'march.eml')
  expect(upload).toHaveBeenCalledWith(file)
  expect(root.querySelector('span')?.textContent).toBe('march.eml')
  expect(root.querySelector('[role="alert"]')).toBeNull()
})
it('says why an upload was refused under the field, still naming the file uploaded before', async () => {
  const root = mount()
  await pick(root, 'march.eml')
  upload.mockRejectedValue(new Error('File is too large to upload.'))
  await pick(root, 'huge.eml')
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('File is too large to upload.')
  expect(root.querySelector('span')?.textContent).toBe('march.eml')
})
it('drops the refusal once a file uploads', async () => {
  const root = mount()
  upload.mockRejectedValueOnce(new Error('File is too large to upload.'))
  await pick(root, 'huge.eml')
  await pick(root, 'march.eml')
  expect(root.querySelector('[role="alert"]')).toBeNull()
  expect(root.querySelector('span')?.textContent).toBe('march.eml')
})
