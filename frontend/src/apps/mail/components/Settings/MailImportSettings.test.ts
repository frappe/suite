import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import MailImportSettings from './MailImportSettings.vue'

const state = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/apps/mail/socket', () => ({ useMailSocket: () => ({ on: vi.fn(), off: vi.fn() }) }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    mailboxes: { data: [{ id: 'inbox', _name: 'Inbox' }] },
    userResource: { data: { name: 'leo@northwind.test' } },
  }),
}))
vi.mock('@/platform/feedback', () => ({ failureText: (error: Error) => error.message }))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: { mail: api },
    // No import is running
    useQuery: () =>
      reactive({ isFetching: false, error: null, data: null, refetch: async () => {} }),
    useMutation: () => fakeMutation(state.run, vi.fn()),
  }
})
vi.mock('frappe-ui', () => ({
  Alert: { render: () => null },
  ErrorMessage: { render: () => null },
  FormControl: { render: () => null },
  FormLabel: { render: () => null },
  Button: defineComponent({
    props: { label: { type: String, default: '' }, disabled: Boolean, loading: Boolean },
    setup(props) {
      return () => h('button', { disabled: props.disabled || props.loading }, props.label)
    },
  }),
}))

/** The upload requests sent, each answered by hand, as a slow upload ends when it ends. */
const uploads: Upload[] = []
class Upload {
  static readonly DONE = 4
  readonly upload = { addEventListener: vi.fn() }
  readonly addEventListener = vi.fn()
  readonly open = vi.fn()
  readonly setRequestHeader = vi.fn()
  readyState = 0
  status = 0
  responseText = ''
  onreadystatechange?: () => void

  send() {
    uploads.push(this)
  }

  /** Ends the upload, with the file saved at `url`. */
  async saveAt(url: string) {
    const saved = { name: url, file_name: url, file_url: url, is_private: 1 }
    Object.assign(this, { readyState: Upload.DONE, status: 200 })
    this.responseText = JSON.stringify({ message: saved })
    this.onreadystatechange?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(MailImportSettings, { isActive: true })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  return root
}

/** Picks a file of this name in the form's file picker. Its upload stays unanswered. */
async function pick(root: HTMLElement, name: string) {
  const input = requireTestElement(root.querySelector('input[type="file"]'), HTMLInputElement)
  Object.defineProperty(input, 'files', { value: [new File(['mail'], name)], configurable: true })
  input.dispatchEvent(new Event('change'))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function startButton(root: HTMLElement) {
  const button = Array.from(root.querySelectorAll('button')).find(
    (entry) => entry.textContent === 'Start import',
  )
  return requireTestElement(button, HTMLButtonElement)
}

beforeEach(() => {
  window.__ = (text: string) => text
  vi.stubGlobal('XMLHttpRequest', Upload)
  uploads.length = 0
  state.run.mockReset()
})
afterEach(() => {
  app.unmount()
  vi.unstubAllGlobals()
})

it('holds Start import back while another file uploads, then imports that file', async () => {
  const root = mount()
  await pick(root, 'march.eml')
  await uploads[0].saveAt('/private/files/march.eml')
  expect(startButton(root).disabled).toBe(false)

  await pick(root, 'april.eml')
  expect(root.querySelector('span')?.textContent).toBe('april.eml')
  expect(startButton(root).disabled).toBe(true)

  await uploads[1].saveAt('/private/files/april.eml')
  startButton(root).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(state.run).toHaveBeenCalledWith(
    expect.objectContaining({ file: '/private/files/april.eml' }),
  )
})
