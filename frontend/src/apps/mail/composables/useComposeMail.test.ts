import type { Editor as TiptapEditor } from '@tiptap/core'
import { Editor, EditorContent } from 'frappe-ui/editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, onMounted, useTemplateRef } from 'vue'

import type { ComposeMailData } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { CustomImageExtension, mailEditorKit } from '@/apps/mail/utils/text-editor'

import { useComposeMail } from './useComposeMail'

const server = vi.hoisted(() => ({ updateDraft: vi.fn(), create: vi.fn(), mutation: vi.fn() }))
const pickFiles = vi.hoisted(() => vi.fn())
const requestCompose = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.stubGlobal('__', (text: string) => text)
const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, currentRoute: { value: { fullPath: '/' } } }),
  useRoute: () => ({ params: {} }),
}))
vi.mock('frappe-ui', () => ({ toast: { error: toastError, success: vi.fn(), dismiss: vi.fn() } }))
vi.mock('frappe-ui/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('frappe-ui/editor')>()),
  Mention: { extend: () => ({ configure: () => ({}) }) },
}))
vi.mock('@/apps/mail/utils/mentionSuggestion', () => ({ createMentionSuggestion: () => ({}) }))
vi.mock('@/apps/mail/resources', () => ({ getAttachmentUrl: vi.fn() }))
// The suite router, which Mail's store imports.
vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/api', () => ({
  api: {
    mail: {
      messages: { create: 'create', updateDraft: 'updateDraft', deleteDraft: 'deleteDraft' },
      scheduled: { cancel: 'cancel' },
      attachments: { fromDrive: 'fromDrive' },
    },
  },
  client: { mutation: (reference: string, input: unknown) => server.mutation(reference, input) },
  useMutation: (reference: 'create' | 'updateDraft') => ({
    run: (input: unknown) => server[reference](input),
    isPending: false,
  }),
}))
vi.mock('@/apps/mail/utils', () => ({
  commitAfterUndo: vi.fn(),
  // The body goes out with the quote below it, as the real one sends it.
  processInlineImages: (mail: ComposeMailData) => ({
    html_body: mail.html_body! + (mail.quoted_content ?? ''),
    attachments: mail.attachments,
  }),
  formatBytes: (bytes: number) => `${bytes} bytes`,
  raiseError: vi.fn(),
  raiseToast: vi.fn(),
  randomString: () => 'cid1',
}))
vi.mock('@/apps/drive', () => ({ useDriveDialogs: () => ({ pickFiles }) }))
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
        mailboxes: ref({ data: [{ id: 'mbx-sent', slug: 'sent', role: 'sent' }] }),
        mailboxIds: ref({ sent: 'mbx-sent' }),
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
type Upload = Parameters<typeof useComposeMail>[0]['uploadInlineImage']
function compose({
  signedInAs = 'maya@example.com',
  host = () => null,
  upload = vi.fn(),
  maxAttachmentSize,
}: {
  signedInAs?: string
  host?: () => ComposerHost
  upload?: Upload
  maxAttachmentSize?: number
} = {}) {
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
          uploadInlineImage: upload,
        })
        composer.onOpened()
        return () => null
      },
    }),
  )
  app.provide('$user', { data: { name: signedInAs, max_attachment_size: maxAttachmentSize } })
  app.mount(document.createElement('div'))
  apps.push(app)
  return composer
}

beforeEach(() => {
  routerPush.mockReset()
  open = true
  scope.identities = mayaIdentities
  draft.attachments = []
  server.updateDraft.mockReset()
  server.mutation.mockReset()
  pickFiles.mockReset()
  requestCompose.mockReset()
  toastError.mockReset()
  vi.mocked(raiseToast).mockReset()
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

  it('keeps what was typed, even where the editor has yet to catch up', async () => {
    const host = editorHolding(() => '<div>typ</div>')
    const composer = compose({ host: () => host })

    composer.onEditorChange('<div>typed</div>')
    await nextTick()
    await nextTick()

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
            uploadInlineImage: vi.fn(),
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
    expect(message).toBe('Draft not saved')
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

describe('an image held in the body as a data URL', () => {
  // A 1×1 transparent PNG.
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const imagesOf = (html: string) =>
    [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    )
  const savedBody = (call: number) => server.updateDraft.mock.calls[call][0].html_body
  // An upload that waits until the test lets it through.
  const heldUpload = () => {
    let finish!: () => void
    const upload = vi.fn<Upload>(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(fromPartial({ file_url: '/private/files/pasted.png' }))
        }),
    )
    return { upload, finish: () => finish() }
  }

  it('keeps what was typed while it uploaded', async () => {
    const { upload, finish } = heldUpload()
    const composer = compose({ upload })
    server.updateDraft.mockResolvedValue({ id: 'draft-1', status: 'Drafted', error: null })
    composer.onEditorChange(`<div>See this:</div><img src="${png}">`)

    const saving = composer.saveDraft()
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    composer.onEditorChange(`<div>See this, and the rest:</div><img src="${png}">`)
    finish()
    await saving

    for (const body of [composer.mail.html_body, savedBody(0)]) {
      expect(body).toContain('See this, and the rest:')
      expect(imagesOf(body)).toEqual(['/private/files/pasted.png'])
    }
  })

  it('leaves the caret, and an image the editor is still uploading, where they were', async () => {
    const { upload, finish } = heldUpload()
    let editor!: TiptapEditor
    let composer!: ReturnType<typeof useComposeMail>
    const app = createApp(
      defineComponent({
        setup() {
          const host = useTemplateRef<NonNullable<ComposerHost>>('editor')
          composer = useComposeMail({
            mailDetails: { ...draft, html_body: `<div>See this</div><img src="${png}">` },
            reloadMails: vi.fn(),
            close: vi.fn(),
            isOpen: () => true,
            host: () => host.value,
            uploadInlineImage: upload,
          })
          onMounted(() => composer.onOpened())
          return () =>
            h(
              Editor,
              {
                ref: 'editor',
                modelValue: composer.editorContent.value,
                extensions: mailEditorKit({ image: CustomImageExtension }),
                onChange: composer.onEditorChange,
              },
              {
                default: (slot: { editor: TiptapEditor }) => {
                  editor = slot.editor
                  return h(EditorContent, { editor: slot.editor })
                },
              },
            )
        },
      }),
    )
    app.provide('$user', { data: { name: 'maya@example.com' } })
    app.mount(document.body.appendChild(document.createElement('div')))
    apps.push(app)
    await nextTick()
    server.updateDraft.mockResolvedValue({ id: 'draft-1', status: 'Drafted', error: null })

    // The caret at the end of the first line, and an edit there to save.
    editor.commands.setTextSelection({ from: 9, to: 9 })
    editor.commands.insertContent(':')
    const saving = composer.saveDraft()
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    // Meanwhile another image is pasted, below the caret, and starts its own upload.
    editor
      .chain()
      .insertContentAt(
        editor.state.doc.content.size,
        { type: 'image', attrs: { src: null, uploadId: 'pasting' } },
        { updateSelection: false },
      )
      .run()
    finish()
    await saving
    editor.commands.insertContent(' and the rest')

    const images: Record<string, unknown>[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') images.push(node.attrs)
    })
    expect(images).toMatchObject([
      { src: '/private/files/pasted.png' },
      { src: null, uploadId: 'pasting' },
    ])
    expect(editor.getHTML()).toMatch(/^<div>See this: and the rest<\/div>/)
    expect(imagesOf(savedBody(0))[0]).toBe('/private/files/pasted.png')
  })

  it('goes as a file from a forwarded mail’s quote too', async () => {
    const { upload, finish } = heldUpload()
    const composer = compose({ upload })
    server.updateDraft.mockResolvedValue({ id: 'sent-1', status: 'Submitted', error: null })
    composer.mail.quoted_content = `<blockquote><img src="${png}"></blockquote>`

    const sending = composer.sendMail()
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    finish()
    await sending

    expect(imagesOf(savedBody(0))).toEqual(['/private/files/pasted.png'])
  })

  it('holds back a save that comes while a send uploads it', async () => {
    const { upload, finish } = heldUpload()
    const composer = compose({ upload })
    server.updateDraft.mockResolvedValue({ id: 'sent-1', status: 'Submitted', error: null })
    composer.onEditorChange(`<div>See this:</div><img src="${png}">`)

    const sending = composer.sendMail()
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    await composer.saveDraft()
    finish()
    await sending

    expect(server.updateDraft).toHaveBeenCalledOnce()
    expect(server.updateDraft.mock.calls[0][0]).toMatchObject({ submit: true })
  })

  it('still saves when its upload is refused, and uploads it on the next save', async () => {
    const upload = vi
      .fn<Upload>()
      .mockRejectedValueOnce(new Error('image.png is too large to attach.'))
      .mockResolvedValueOnce(fromPartial({ file_url: '/private/files/pasted.png' }))
    const composer = compose({ upload })
    server.updateDraft.mockResolvedValue({ id: 'draft-1', status: 'Drafted', error: null })

    composer.onEditorChange(`<div>See this:</div><img src="${png}">`)
    await composer.saveDraft()
    expect(composer.isSaveFailed.value).toBe(false)
    expect(imagesOf(savedBody(0))).toEqual([png])

    composer.onEditorChange(`<div>See this, again:</div><img src="${png}">`)
    await composer.saveDraft()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(imagesOf(savedBody(1))).toEqual(['/private/files/pasted.png'])
  })

  // Gmail and Outlook block data URLs, and base64 can take a mail past the size limit.
  it('refuses a send whose upload failed, naming the image, and keeps the composer open', async () => {
    const upload = vi.fn<Upload>().mockRejectedValue(new Error('Server error'))
    const composer = compose({ upload })
    composer.onEditorChange(
      `<div>See this:</div><img src="${png.replace(';base64', ';name=chart.png;base64')}">`,
    )

    await composer.sendMail()

    expect(server.updateDraft).not.toHaveBeenCalled()
    expect(open).toBe(true)
    expect(raiseToast).toHaveBeenCalledWith(expect.stringContaining('chart.png'), 'error')
  })

  it('refuses a scheduled send the same way, naming an unnamed image by its place', async () => {
    const upload = vi.fn<Upload>().mockRejectedValue(new Error('Server error'))
    const composer = compose({ upload })
    composer.onEditorChange(
      `<img src="/private/files/logo.png" data-cid="x"><img src="${png}" alt="">`,
    )

    await expect(composer.sendMail('2026-11-17 09:00:00')).rejects.toThrow(/Image 2\b/)
    expect(server.updateDraft).not.toHaveBeenCalled()
    expect(open).toBe(true)
  })

  it('is refused for its size only on Send, never on an autosave', async () => {
    const upload = vi.fn<Upload>()
    // The image is 68 bytes.
    const composer = compose({ upload, maxAttachmentSize: 50 })
    server.updateDraft.mockResolvedValue({ id: 'draft-1', status: 'Drafted', error: null })
    composer.onEditorChange(`<div>See this:</div><img src="${png}">`)

    await composer.saveDraft()
    composer.onEditorChange(`<div>See this, again:</div><img src="${png}">`)
    await composer.saveDraft()
    expect(server.updateDraft).toHaveBeenCalledTimes(2)
    // The host's upload is where an editor upload over the limit is refused with a toast.
    expect(upload).not.toHaveBeenCalled()
    expect(raiseToast).not.toHaveBeenCalled()

    await composer.sendMail()
    expect(server.updateDraft).toHaveBeenCalledTimes(2)
    expect(open).toBe(true)
    expect(raiseToast).toHaveBeenCalledOnce()
    expect(raiseToast).toHaveBeenCalledWith(expect.stringMatching(/68 bytes.*50 bytes/), 'error')
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

  it('links its toast to the thread in Sent, naming the folder as the URL does', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValueOnce({
      id: 'sent-1',
      status: 'Submitted',
      error: null,
      thread_id: 'thread-1',
    })
    await composer.sendMail()

    const sent = vi.mocked(raiseToast).mock.calls.find(([message]) => message === 'Message sent')
    sent?.[2]?.onClick()

    // By path, which opens from another app before Mail's routes load; by slug, which the guard
    // leaves alone, so the page the reader sent from stays in the history behind it.
    expect(routerPush).toHaveBeenCalledWith('/mail/account/account/mailbox/sent/thread-1')
  })
})

describe('attaching from Drive', () => {
  const invoice = { name: 'node-invoice', title: 'Invoice.pdf' }
  const copy = {
    name: 'file-1',
    file_name: 'Invoice.pdf',
    file_url: '/private/files/Invoice.pdf',
    file_size: 2048,
  }
  const sent = () => server.updateDraft.mock.calls.filter(([input]) => input.submit)

  it('holds the send, and a scheduled send, until the copy is on the mail', async () => {
    const composer = compose()
    pickFiles.mockResolvedValueOnce([invoice])
    let finishCopy!: (files: (typeof copy)[]) => void
    server.mutation.mockReturnValueOnce(new Promise((resolve) => (finishCopy = resolve)))

    const attaching = composer.attachFromDrive()
    await vi.waitFor(() => expect(server.mutation).toHaveBeenCalled())
    expect(composer.isUploading.value).toBe(true)

    await composer.sendMail()
    await expect(composer.scheduleSend('2026-11-20T09:00:00Z')).rejects.toThrow(
      'Wait for attachments to finish uploading',
    )
    expect(sent()).toHaveLength(0)
    expect(raiseToast).toHaveBeenCalledWith('Wait for attachments to finish uploading', 'error')

    finishCopy([copy])
    await attaching
    expect(composer.isUploading.value).toBe(false)
    server.updateDraft.mockResolvedValueOnce({ id: 'sent-1', status: 'Submitted', error: null })
    await composer.sendMail()
    expect(sent()).toHaveLength(1)
  })

  it('sends the copy as a file on the site, not as a blob already on the mail server', async () => {
    const composer = compose()
    pickFiles.mockResolvedValueOnce([invoice])
    server.mutation.mockResolvedValueOnce([copy])

    await composer.attachFromDrive()
    expect(server.mutation).toHaveBeenCalledWith('fromDrive', { nodes: ['node-invoice'] })

    server.updateDraft.mockResolvedValueOnce({ id: 'sent-1', status: 'Submitted', error: null })
    await composer.sendMail()
    const [attachment] = sent()[0][0].attachments
    expect(attachment).toMatchObject({
      file_name: 'Invoice.pdf',
      file_url: '/private/files/Invoice.pdf',
      disposition: 'attachment',
    })
    expect(attachment.blob_id).toBeFalsy()
  })

  it('attaches nothing when the copy is refused, and lets the mail go without it', async () => {
    const composer = compose()
    pickFiles.mockResolvedValueOnce([invoice])
    server.mutation.mockRejectedValueOnce(new Error('You cannot read Invoice.pdf'))

    await composer.attachFromDrive()

    expect(composer.mail.attachments).toEqual([])
    expect(composer.isUploading.value).toBe(false)
    server.updateDraft.mockResolvedValueOnce({ id: 'sent-1', status: 'Submitted', error: null })
    await composer.sendMail()
    expect(sent()).toHaveLength(1)
  })

  it('asks the server for nothing when the picker is cancelled', async () => {
    const composer = compose()
    pickFiles.mockResolvedValueOnce(undefined)

    await composer.attachFromDrive()

    expect(server.mutation).not.toHaveBeenCalled()
    expect(composer.mail.attachments).toEqual([])
  })
})
