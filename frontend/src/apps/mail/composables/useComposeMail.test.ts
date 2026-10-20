import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, ref } from 'vue'

import type { ComposeMailData } from '@/apps/mail/types'

import { useComposeMail } from './useComposeMail'

const server = vi.hoisted(() => ({ updateDraft: vi.fn(), create: vi.fn() }))
const requestCompose = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.stubGlobal('__', (text: string) => text)
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { fullPath: '/' } } }),
  useRoute: () => ({ params: {} }),
}))
vi.mock('frappe-ui', () => ({ toast: { error: toastError, success: vi.fn(), dismiss: vi.fn() } }))
vi.mock('frappe-ui/editor', () => ({ Mention: { extend: () => ({ configure: () => ({}) }) } }))
vi.mock('@/apps/mail/utils/mentionSuggestion', () => ({ createMentionSuggestion: () => ({}) }))
vi.mock('@/apps/mail/resources', () => ({ getAttachmentUrl: vi.fn() }))
vi.mock('@/api', () => ({
  api: {
    mail: {
      messages: { create: 'create', updateDraft: 'updateDraft', deleteDraft: 'deleteDraft' },
      scheduled: { cancel: 'cancel' },
    },
  },
  client: { mutation: vi.fn() },
  useMutation: (reference: 'create' | 'updateDraft') => ({
    run: (input: unknown) => server[reference](input),
    isPending: false,
  }),
}))
vi.mock('@/apps/mail/utils', () => ({
  commitAfterUndo: vi.fn(),
  processInlineImages: (mail: ComposeMailData) => ({
    html_body: mail.html_body,
    attachments: mail.attachments,
  }),
  raiseError: vi.fn(),
  raiseToast: vi.fn(),
}))
vi.mock('@/apps/mail/utils/accountScope', () => ({
  injectAccountScope: () => ({
    accountId: ref('account'),
    account: ref({ default_outgoing_email: 'maya@example.com' }),
    identities: ref({ data: [{ email: 'maya@example.com', _name: 'Maya' }] }),
    mailboxIds: ref({}),
  }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useComposeMail: () => ({ requestCompose }),
  useDiscardingDrafts: () => ({ holdDraft: vi.fn(), releaseDraft: vi.fn(), restoreDraft: vi.fn() }),
  useListReload: () => ({ requestListReload: vi.fn() }),
  useUndo: () => ({ setUndoAction: vi.fn(), retireUndoAction: vi.fn() }),
}))

const draft: ComposeMailData = {
  id: 'draft-1',
  to: [{ email: 'dana@brightwave.example' }],
  subject: 'Fwd: Brief',
  html_body: '<p>See the brief.</p>',
  attachments: [],
}

let open = true
const apps: ReturnType<typeof createApp>[] = []
function compose() {
  let composer!: ReturnType<typeof useComposeMail>
  const app = createApp(
    defineComponent({
      setup() {
        composer = useComposeMail({
          mailDetails: draft,
          reloadMails: vi.fn(),
          close: () => (open = false),
          isOpen: () => open,
          host: () => null,
        })
        composer.onOpened()
        return () => null
      },
    }),
  )
  app.provide('$user', { data: { name: 'maya@example.com' } })
  app.mount(document.createElement('div'))
  apps.push(app)
  return composer
}

beforeEach(() => {
  open = true
  server.updateDraft.mockReset()
  requestCompose.mockReset()
  toastError.mockReset()
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

describe('saving a draft', () => {
  it('shows a refused save until a retry lands', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(new Error('Attachment is not a site file'))
    composer.mail.html_body = '<p>See the brief. Edited.</p>'
    await composer.saveDraft()
    expect(composer.isSaveFailed.value).toBe(true)

    server.updateDraft.mockResolvedValueOnce({ id: 'draft-2', status: 'Drafted', error: null })
    await composer.saveDraft()
    expect(server.updateDraft).toHaveBeenCalledTimes(2)
    expect(composer.isSaveFailed.value).toBe(false)
  })

  it('keeps the draft dirty when the server answers with an error', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValueOnce({ id: 'draft-1', status: 'Draft', error: 'Refused' })
    composer.mail.subject = 'Fwd: Brief v2'
    await composer.saveDraft()
    expect(composer.isSaveFailed.value).toBe(true)
    expect(composer.isDraftUpdated.value).toBe(true)
  })

  it('keeps a draft whose save on close was refused, ready to reopen', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(new Error('Attachment is not a site file'))
    composer.mail.html_body = '<p>Last words.</p>'
    open = false
    await composer.saveDraft()
    await nextTick()

    expect(toastError).toHaveBeenCalledOnce()
    const [message, options] = toastError.mock.calls[0]
    expect(message).toBe('Draft not saved.')
    options.action.onClick()
    expect(requestCompose).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'draft-1',
        html_body: '<p>Last words.</p>',
        account: 'account',
        restored: true,
      }),
    )
  })
})
