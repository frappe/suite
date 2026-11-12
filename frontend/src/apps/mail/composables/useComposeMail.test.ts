import { Editor, EditorContent } from 'frappe-ui/editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, onMounted, useTemplateRef } from 'vue'

import type { ComposeMailData } from '@/apps/mail/types'
import { mailEditorKit } from '@/apps/mail/utils/text-editor'

import { useComposeMail } from './useComposeMail'

const server = vi.hoisted(() => ({ updateDraft: vi.fn(), create: vi.fn() }))
const requestCompose = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.stubGlobal('__', (text: string) => text)
const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { fullPath: '/' } } }),
  useRoute: () => ({ params: {} }),
}))
vi.mock('frappe-ui', () => ({ toast: { error: toastError, success: vi.fn(), dismiss: vi.fn() } }))
vi.mock('frappe-ui/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('frappe-ui/editor')>()),
  Mention: { extend: () => ({ configure: () => ({}) }) },
}))
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
interface TestIdentity {
  email: string
  _name: string
  html_signature?: string
}
const mayaIdentities: TestIdentity[] = [{ email: 'maya@example.com', _name: 'Maya' }]
// The account's identities as a composer opens (undefined: not loaded yet), and a way to load them.
const scope = vi.hoisted<{
  identities?: TestIdentity[]
  load: (identities: TestIdentity[]) => void
}>(() => ({ load: () => {} }))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { ref } = await import('vue')
  return {
    injectAccountScope: () => {
      const identities = ref<{ data?: TestIdentity[] }>({ data: scope.identities })
      scope.load = (data) => (identities.value = { data })
      return {
        accountId: ref('account'),
        account: ref({ default_outgoing_email: 'maya@example.com' }),
        identities,
        mailboxIds: ref({}),
      }
    },
  }
})
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

type ComposerHost = Parameters<typeof useComposeMail>[0]['host'] extends () => infer H ? H : never

let open = true
const apps: ReturnType<typeof createApp>[] = []
function compose({
  signedInAs = 'maya@example.com',
  host = () => null,
}: { signedInAs?: string; host?: () => ComposerHost } = {}) {
  let composer!: ReturnType<typeof useComposeMail>
  const app = createApp(
    defineComponent({
      setup() {
        composer = useComposeMail({
          mailDetails: draft,
          reloadMails: vi.fn(),
          close: () => (open = false),
          isOpen: () => open,
          host,
        })
        composer.onOpened()
        return () => null
      },
    }),
  )
  app.provide('$user', { data: { name: signedInAs } })
  app.mount(document.createElement('div'))
  apps.push(app)
  return composer
}

beforeEach(() => {
  open = true
  scope.identities = mayaIdentities
  server.updateDraft.mockReset()
  requestCompose.mockReset()
  toastError.mockReset()
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

describe('the From address', () => {
  it('moves to the mailbox once the identities load, when the composer opened before them', async () => {
    scope.identities = undefined
    const composer = compose({ signedInAs: 'maya@personal.example' })

    scope.load(mayaIdentities)
    await nextTick()

    expect(composer.mail.from_email).toBe('maya@example.com')
  })
})

describe('the body and the editor', () => {
  const editorHolding = (getHTML: () => string) =>
    fromPartial<ComposerHost>({
      editor: {
        getHTML,
        commands: { setTextSelection: vi.fn() },
        state: { selection: { from: 1, to: 1 } },
      },
    })

  it('carries what the editor made of an unfolded quote', async () => {
    const normalised = '<div>See the brief.</div><div class="frappe_mail_quote">old</div>'
    const host = editorHolding(() => normalised)
    const composer = compose({ host: () => host })
    composer.mail.quoted_content = '<div class="frappe_mail_quote">old</div>'

    composer.openQuotedContent()
    await nextTick()
    await nextTick()

    expect(composer.mail.html_body).toBe(normalised)
    expect(composer.mail.quoted_content).toBe('')
  })

  it('does not read the editor back for what the editor itself just said', async () => {
    const getHTML = vi.fn(() => '<div>typed</div>')
    const host = editorHolding(getHTML)
    const composer = compose({ host: () => host })

    composer.onEditorChange('<div>typed</div>')
    await nextTick()
    await nextTick()

    expect(getHTML).not.toHaveBeenCalled()
    expect(composer.mail.html_body).toBe('<div>typed</div>')
  })

  it('starts a reply above a signature that arrives after it opened', async () => {
    scope.identities = undefined
    let body!: ComposerHost
    const app = createApp(
      defineComponent({
        setup() {
          const editor = useTemplateRef<NonNullable<ComposerHost>>('editor')
          const composer = useComposeMail({
            mailDetails: { ...draft, id: undefined, html_body: '', in_reply_to: '<m1@x.example>' },
            reloadMails: vi.fn(),
            close: vi.fn(),
            isOpen: () => true,
            host: () => editor.value,
          })
          onMounted(() => {
            composer.onOpened()
            body = editor.value
            body?.editor?.commands.focus()
          })
          return () =>
            h(
              Editor,
              {
                ref: 'editor',
                modelValue: composer.editorContent.value,
                extensions: mailEditorKit(),
                onChange: composer.onEditorChange,
              },
              { default: ({ editor }: { editor: never }) => h(EditorContent, { editor }) },
            )
        },
      }),
    )
    app.provide('$user', { data: { name: 'maya@example.com' } })
    app.mount(document.body.appendChild(document.createElement('div')))
    apps.push(app)
    await nextTick()

    scope.load([{ ...mayaIdentities[0], html_signature: '<div>Maya</div>' }])
    await nextTick()
    await nextTick()
    body?.editor?.commands.insertContent('Thanks')

    expect(body?.editor?.getHTML()).toMatch(/^<div>Thanks<\/div>.*Maya/)
  })

  it('writes a blank line in the form mail clients keep', () => {
    const composer = compose()
    composer.onEditorChange('<div>a</div><div></div><div>b</div>')
    expect(composer.mail.html_body).toBe('<div>a</div><div><br></div><div>b</div>')
  })
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

  it('does not start a second save while one is under way', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValueOnce({ id: 'draft-2', status: 'Drafted', error: null })
    composer.mail.html_body = '<p>See the brief. Edited.</p>'
    await Promise.all([composer.saveDraft(), composer.saveDraft()])
    expect(server.updateDraft).toHaveBeenCalledOnce()
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

describe('a reminder if nobody replies', () => {
  it('goes with the send, and never with a saved draft', async () => {
    const composer = compose()
    await composer.setRemindAt('2026-11-10T09:00:00Z')

    server.updateDraft.mockResolvedValueOnce({ id: 'draft-1', status: 'Drafted', error: null })
    composer.mail.html_body = '<p>Still writing.</p>'
    await composer.saveDraft()
    expect(server.updateDraft.mock.calls[0][0].remind_at).toBeUndefined()

    server.updateDraft.mockResolvedValueOnce({ id: 'sent-1', status: 'Submitted', error: null })
    await composer.sendMail()
    expect(server.updateDraft.mock.calls.at(-1)![0]).toMatchObject({
      submit: true,
      remind_at: '2026-11-10T09:00:00Z',
    })
  })

  it('is not asked for once taken back', async () => {
    const composer = compose()
    await composer.setRemindAt('2026-11-10T09:00:00Z')
    await composer.setRemindAt()

    server.updateDraft.mockResolvedValueOnce({ id: 'sent-1', status: 'Submitted', error: null })
    await composer.sendMail()
    expect(server.updateDraft.mock.calls.at(-1)![0].remind_at).toBeUndefined()
  })
})
