import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import { translationPlugin } from '@/platform/translation'

import WorkspaceLogoUploader from './WorkspaceLogoUploader.vue'

// Tests swap frappe-ui for a stub; this one needs its real uploader and upload request.
vi.mock('frappe-ui', async () => ({
  FileUploader: (
    await import('../../../node_modules/frappe-ui/src/components/FileUploader/FileUploader.vue')
  ).default,
}))

/** Stands in for the browser's upload request, so a test can move it along by hand. */
class FakeUpload {
  static last: FakeUpload | undefined
  upload = new EventTarget()
  readyState = 0
  status = 0
  responseText = ''
  onreadystatechange: (() => void) | null = null
  private events = new EventTarget()
  constructor() {
    FakeUpload.last = this
  }
  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener)
  }
  open() {}
  setRequestHeader() {}
  send() {
    this.upload.dispatchEvent(new Event('loadstart'))
  }
  sent(uploaded: number, total: number) {
    this.upload.dispatchEvent(
      Object.assign(new Event('progress'), { lengthComputable: true, loaded: uploaded, total }),
    )
  }
  finish(status: number, body: unknown) {
    this.readyState = 4
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onreadystatechange?.()
  }
}

let unmount: (() => void) | undefined
beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', Object.assign(FakeUpload, { DONE: 4 }))
  URL.createObjectURL = () => 'blob:picked-logo'
  URL.revokeObjectURL = () => {}
})
afterEach(() => {
  unmount?.()
  vi.unstubAllGlobals()
})

function mount(start: string) {
  const logo = ref(start)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(WorkspaceLogoUploader, {
        modelValue: logo.value,
        'onUpdate:modelValue': (value: string) => (logo.value = value),
      }),
  })
  app.use(translationPlugin)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  return { root, logo }
}

async function pick(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', {
    value: [new File(['png'], 'logo.png', { type: 'image/png' })],
  })
  input.dispatchEvent(new Event('change'))
  await vi.waitFor(() => expect(FakeUpload.last).toBeDefined())
}

const tile = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('button')!

it('shows the picked logo at once and reports how far its upload has got', async () => {
  FakeUpload.last = undefined
  const { root, logo } = mount('')
  await pick(root)

  FakeUpload.last!.sent(40, 100)
  await vi.waitFor(() => expect(tile(root).getAttribute('aria-label')).toBe('Uploading logo, 40%'))
  expect(tile(root).getAttribute('aria-busy')).toBe('true')
  expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:picked-logo')
  expect(logo.value).toBe('')

  FakeUpload.last!.finish(200, { message: { file_url: '/files/acme.png' } })
  await vi.waitFor(() => expect(logo.value).toBe('/files/acme.png'))
  expect(tile(root).getAttribute('aria-label')).toBe('Replace logo')
  expect(root.querySelector('img')?.getAttribute('src')).toBe('/files/acme.png')
})

it('goes back to the saved logo when the upload fails', async () => {
  FakeUpload.last = undefined
  const { root, logo } = mount('/files/old.png')
  await pick(root)
  FakeUpload.last!.sent(70, 100)
  await vi.waitFor(() => expect(tile(root).getAttribute('aria-busy')).toBe('true'))

  FakeUpload.last!.finish(500, { message: 'Disk full' })
  await vi.waitFor(() => expect(tile(root).getAttribute('aria-busy')).toBe('false'))
  expect(root.querySelector('img')?.getAttribute('src')).toBe('/files/old.png')
  expect(tile(root).getAttribute('title')).toBeTruthy()
  expect(logo.value).toBe('/files/old.png')
})
