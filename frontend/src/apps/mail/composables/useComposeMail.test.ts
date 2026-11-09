import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, ref } from 'vue'

import { stopDraftSavers } from '@/apps/mail/composables/draftSaver'
import type { Attachment, ComposeMailData } from '@/apps/mail/types'
import { TransportError } from '@/platform/transport'

import { useComposeMail } from './useComposeMail'

const server = vi.hoisted(() => ({ updateDraft: vi.fn(), create: vi.fn(), deleteDraft: vi.fn() }))
const requestCompose = vi.hoisted(() => vi.fn())
type UnsavedToast = { action: { onClick: () => void } }
const toastError = vi.hoisted(() =>
  vi.fn<(message: string, options: UnsavedToast) => string>(() => 'toast-id'),
)
const toastDismiss = vi.hoisted(() => vi.fn())
const raiseToast = vi.hoisted(() => vi.fn())
const commitAfterUndo = vi.hoisted(() => vi.fn())

const scopeAccount = ref('account')
vi.stubGlobal('__', (text: string, args: string[] = []) =>
  args.reduce((result, arg, index) => result.replace(`{${index}}`, arg), text),
)
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { fullPath: '/' } } }),
  useRoute: () => ({ params: {} }),
}))
vi.mock('frappe-ui', () => ({
  toast: { error: toastError, success: vi.fn(), warning: vi.fn(), dismiss: toastDismiss },
}))
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
  client: {
    mutation: (reference: 'create' | 'updateDraft', input: unknown, options: unknown) =>
      server[reference](input, options),
  },
  useMutation: vi.fn(() => ({ run: vi.fn(), isPending: false })),
}))
vi.mock('@/apps/mail/utils', () => ({
  commitAfterUndo,
  processInlineImages: (mail: ComposeMailData) => ({
    html_body: mail.html_body,
    attachments: mail.attachments,
  }),
  raiseError: vi.fn(),
  raiseToast,
}))
interface TestIdentity {
  email: string
  _name: string
}
const mayaIdentities: TestIdentity[] = [{ email: 'maya@example.com', _name: 'Maya' }]
// The account's identities as a composer opens (undefined: not loaded yet), and a way to load them.
const scope = vi.hoisted<{
  identities?: TestIdentity[]
  load: (identities: TestIdentity[]) => void
}>(() => ({ load: () => {} }))
vi.mock('@/apps/mail/utils/accountScope', () => ({
  injectAccountScope: () => {
    const identities = ref<{ data?: TestIdentity[] }>({ data: scope.identities })
    scope.load = (data) => (identities.value = { data })
    return {
      accountId: scopeAccount,
      account: ref({ default_outgoing_email: 'maya@example.com' }),
      identities,
      mailboxIds: ref({}),
    }
  },
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useComposeMail: () => ({ requestCompose }),
  useDiscardingDrafts: () => ({ holdDraft: vi.fn(), releaseDraft: vi.fn(), restoreDraft: vi.fn() }),
  useListReload: () => ({ requestListReload: vi.fn() }),
  useUndo: () => ({ setUndoAction: vi.fn(), retireUndoAction: vi.fn() }),
}))

const uploaded = (file_url: string): Attachment => ({
  filename: 'brief.pdf',
  blob_id: '',
  type: 'application/pdf',
  size: 1,
  file_url,
  disposition: 'attachment',
})

const draft: ComposeMailData = {
  id: 'draft-1',
  to: [{ email: 'dana@brightwave.example' }],
  subject: 'Fwd: Brief',
  html_body: '<p>See the brief.</p>',
  attachments: [],
}

const saved = (id: string) => ({ id, status: 'Drafted', error: null })
const sent = { id: 'sent-1', status: 'Submitted', error: null }
const networkDown = () => new TransportError({ type: 'NetworkError', message: 'down', status: 0 })
const serverDown = () => new TransportError({ type: 'ServerError', message: 'boom', status: 502 })
const noSuchDraft = () =>
  new TransportError({ type: 'DoesNotExistError', message: 'Not found', status: 404 })
const deferred = <T = unknown>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
const COPY_PREFIX = 'suite.mail.draftCopy.v1'
const copies = () =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith(COPY_PREFIX))
    .map((key) => JSON.parse(localStorage.getItem(key)!))

let open = true
const apps: ReturnType<typeof createApp>[] = []
function compose(
  mailDetails: ComposeMailData | undefined = draft,
  options: Partial<Parameters<typeof useComposeMail>[0]> = {},
  user = 'maya@example.com',
) {
  let composer!: ReturnType<typeof useComposeMail>
  const app = createApp(
    defineComponent({
      setup() {
        composer = useComposeMail({
          mailDetails: structuredClone(mailDetails),
          reloadMails: vi.fn(),
          close: () => (open = false),
          isOpen: () => open,
          host: () => null,
          ...options,
        })
        composer.onOpened()
        return () => null
      },
    }),
  )
  app.provide('$user', { data: { name: user } })
  app.mount(document.createElement('div'))
  apps.push(app)
  return composer
}

beforeEach(() => {
  open = true
  scopeAccount.value = 'account'
  scope.identities = mayaIdentities
  localStorage.clear()
  server.updateDraft.mockReset()
  server.create.mockReset()
  requestCompose.mockReset()
  toastError.mockClear()
  toastDismiss.mockClear()
  raiseToast.mockClear()
  commitAfterUndo.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  stopDraftSavers()
  for (const app of apps.splice(0)) app.unmount()
  vi.useRealTimers()
})

const tick = () => vi.advanceTimersByTimeAsync(0)

describe('the From address', () => {
  it('moves to the mailbox once the identities load, when the composer opened before them', async () => {
    scope.identities = undefined
    const composer = compose(draft, {}, 'maya@personal.example')

    scope.load(mayaIdentities)
    await nextTick()

    expect(composer.mail.from_email).toBe('maya@example.com')
  })
})

describe('saving a draft', () => {
  it('shows a refused save until a retry lands', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(new Error('Attachment is not a site file'))
    composer.mail.html_body = '<p>See the brief. Edited.</p>'
    await composer.saveDraft()
    expect(composer.saveState.value.status).toBe('failed')

    server.updateDraft.mockResolvedValueOnce(saved('draft-2'))
    await composer.saveDraft()
    expect(server.updateDraft).toHaveBeenCalledTimes(2)
    expect(composer.saveState.value.status).toBe('saved')
  })

  it('does not start a second save while one is under way', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValueOnce(saved('draft-2'))
    composer.mail.html_body = '<p>See the brief. Edited.</p>'
    await Promise.all([composer.saveDraft(), composer.saveDraft()])
    expect(server.updateDraft).toHaveBeenCalledOnce()
  })

  it('keeps the draft dirty when the server answers with an error', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValueOnce({ id: 'draft-1', status: 'Failed', error: 'Refused' })
    composer.mail.subject = 'Fwd: Brief v2'
    await composer.saveDraft()
    expect(composer.saveState.value.status).toBe('failed')
    expect(composer.isDraftUpdated.value).toBe(true)
  })

  it('does not take a failed status without an error for a save', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValueOnce({ id: 'draft-1', status: 'Failed', error: null })
    composer.mail.subject = 'Fwd: Brief v2'
    await composer.saveDraft()
    expect(composer.saveState.value.status).toBe('failed')
  })

  it('saves text typed while a save was on the wire', async () => {
    const composer = compose()
    const first = deferred()
    server.updateDraft.mockReturnValueOnce(first.promise)
    server.updateDraft.mockResolvedValue(saved('draft-3'))

    composer.mail.html_body = '<p>One</p>'
    const saving = composer.saveDraft()
    await tick()
    composer.mail.html_body = '<p>One two</p>'
    await nextTick()
    first.resolve(saved('draft-2'))
    await saving

    const lastSave = server.updateDraft.mock.calls.at(-1)![0]
    expect(lastSave.html_body).toBe('<p>One two</p>')
    // On top of the id the first save left it under.
    expect(lastSave.id).toBe('draft-2')
    expect(composer.saveState.value.status).toBe('saved')
  })

  it('saves an attachment that finished uploading during a save', async () => {
    const composer = compose()
    const first = deferred()
    server.updateDraft.mockReturnValueOnce(first.promise)
    server.updateDraft.mockResolvedValue(saved('draft-3'))

    composer.mail.html_body = '<p>Edited</p>'
    const saving = composer.saveDraft()
    await tick()
    composer.mail.attachments.push(uploaded('/private/files/brief.pdf'))
    await nextTick()
    first.resolve(saved('draft-2'))
    await saving

    expect(server.updateDraft.mock.calls.at(-1)![0].attachments).toEqual([
      uploaded('/private/files/brief.pdf'),
    ])
  })

  it('sends the same draft key with every write of one composition', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValue(saved('draft-2'))
    composer.mail.subject = 'A'
    await composer.saveDraft()
    composer.mail.subject = 'B'
    await composer.saveDraft()
    const [first, second] = server.updateDraft.mock.calls
    expect(first[0].draft_key).toBeTruthy()
    expect(second[0].draft_key).toBe(first[0].draft_key)
  })

  it('stays with the account a saved draft belongs to', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValue(saved('draft-2'))
    scopeAccount.value = 'other-account'
    composer.mail.subject = 'A'
    await composer.saveDraft()
    expect(server.updateDraft.mock.calls[0][0].account).toBe('account')
  })
})

describe('the local copy', () => {
  it('is not written while saving works', async () => {
    const composer = compose()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    server.updateDraft.mockResolvedValue(saved('draft-2'))
    composer.mail.html_body = '<p>Secret</p>'
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)
    expect(server.updateDraft).toHaveBeenCalledOnce()
    expect(copies()).toEqual([])
    expect(setItem.mock.calls.filter(([key]) => key.startsWith(COPY_PREFIX))).toEqual([])
    setItem.mockRestore()
  })

  it('is written when saving fails and removed once a save lands', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(networkDown())
    composer.mail.html_body = '<p>Words</p>'
    await composer.saveDraft()

    expect(copies()).toHaveLength(1)
    expect(copies()[0]).toMatchObject({
      user: 'maya@example.com',
      account: 'account',
      ids: ['draft-1'],
      mail: { html_body: '<p>Words</p>', to: draft.to },
    })
    expect(composer.saveState.value.isCopyKept).toBe(true)

    server.updateDraft.mockResolvedValueOnce(saved('draft-2'))
    await composer.retrySave()
    expect(copies()).toEqual([])
    expect(composer.saveState.value.isCopyKept).toBe(false)
  })

  it('follows edits made while failing', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    composer.mail.html_body = '<p>One</p>'
    await composer.saveDraft()
    composer.mail.html_body = '<p>One two</p>'
    await nextTick()
    expect(copies()[0].mail.html_body).toBe('<p>One two</p>')
  })

  it('names files still uploading, which it cannot hold', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    void composer.trackUpload('brief.pdf', new Promise(() => {}))
    composer.mail.html_body = '<p>One</p>'
    await composer.saveDraft()
    expect(copies()[0].uploading).toEqual(['brief.pdf'])
  })

  it('leaves compose working when storage is blocked, and says nothing is kept', async () => {
    const composer = compose()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    server.updateDraft.mockRejectedValueOnce(networkDown())
    composer.mail.html_body = '<p>One</p>'
    await composer.saveDraft()
    expect(composer.saveState.value).toMatchObject({ status: 'failed', isCopyKept: false })
    expect(composer.isSafeToClose.value).toBe(false)

    server.updateDraft.mockResolvedValueOnce(saved('draft-2'))
    await composer.retrySave()
    expect(composer.saveState.value.status).toBe('saved')
    setItem.mockRestore()
  })

  it('is offered when the same draft is opened again, and only applied if restored', async () => {
    const first = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    first.mail.html_body = '<p>Not on the server</p>'
    await first.saveDraft()
    stopDraftSavers()

    const second = compose()
    await tick()
    expect(second.recoverableCopy.value?.mail.html_body).toBe('<p>Not on the server</p>')
    expect(second.mail.html_body).toBe(draft.html_body)
    expect(server.updateDraft).toHaveBeenCalledOnce()

    server.updateDraft.mockReset()
    server.updateDraft.mockResolvedValue(saved('draft-2'))
    second.restoreCopy()
    expect(second.mail.html_body).toBe('<p>Not on the server</p>')
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(server.updateDraft.mock.calls[0][0].html_body).toBe('<p>Not on the server</p>')
    expect(copies()).toEqual([])
  })

  it('is removed if ignored', async () => {
    const first = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    first.mail.html_body = '<p>Not on the server</p>'
    await first.saveDraft()
    stopDraftSavers()

    const second = compose()
    await tick()
    second.ignoreCopy()
    expect(copies()).toEqual([])
    expect(second.mail.html_body).toBe(draft.html_body)
  })

  it('is not offered to a different person on the same browser', async () => {
    const first = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    first.mail.html_body = '<p>Private</p>'
    await first.saveDraft()
    stopDraftSavers()

    const someoneElse = compose(draft, {}, 'sam@example.com')
    await tick()
    expect(someoneElse.recoverableCopy.value).toBeUndefined()
  })
})

describe('sending', () => {
  it('goes out with what is on screen, in one step, ahead of the pending save', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValue(sent)
    composer.mail.html_body = '<p>Last word</p>'
    await composer.sendMail()

    expect(server.updateDraft).toHaveBeenCalledOnce()
    expect(server.updateDraft.mock.calls[0][0]).toMatchObject({
      submit: true,
      html_body: '<p>Last word</p>',
    })
    expect(open).toBe(false)
  })

  it('waits for a save under way, and goes on the id it left', async () => {
    const composer = compose()
    const landing = deferred()
    server.updateDraft.mockReturnValueOnce(landing.promise)
    server.updateDraft.mockResolvedValueOnce(sent)

    composer.mail.html_body = '<p>One</p>'
    void composer.saveDraft()
    await tick()
    composer.mail.html_body = '<p>One two</p>'
    const sending = composer.sendMail()
    await tick()
    expect(server.updateDraft).toHaveBeenCalledOnce()

    landing.resolve(saved('draft-2'))
    await sending
    expect(server.updateDraft.mock.calls[1][0]).toMatchObject({
      id: 'draft-2',
      submit: true,
      html_body: '<p>One two</p>',
    })
  })

  it('goes out even when the save before it failed, with the text on screen', async () => {
    const composer = compose()
    const landing = deferred()
    server.updateDraft.mockReturnValueOnce(landing.promise)
    server.updateDraft.mockResolvedValueOnce(sent)

    composer.mail.html_body = '<p>One</p>'
    void composer.saveDraft()
    await tick()
    const sending = composer.sendMail()
    landing.reject(serverDown())
    await sending

    expect(server.updateDraft.mock.calls[1][0]).toMatchObject({
      submit: true,
      html_body: '<p>One</p>',
    })
    expect(open).toBe(false)
  })

  it('sends once however many times it is pressed', async () => {
    const composer = compose()
    const landing = deferred()
    server.updateDraft.mockReturnValue(landing.promise)
    const sending = composer.sendMail()
    await tick()
    void composer.sendMail()
    void composer.sendMail()
    await tick()
    landing.resolve(sent)
    await sending
    expect(server.updateDraft).toHaveBeenCalledOnce()
  })

  it('stays open and says not sent when the request fails, keeping the text safe', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(networkDown())
    composer.mail.html_body = '<p>Words</p>'
    await composer.sendMail()

    expect(open).toBe(true)
    expect(raiseToast).toHaveBeenCalledWith('Not sent. Could not reach the server.', 'error')
    expect(raiseToast).not.toHaveBeenCalledWith('Message sent.', expect.anything())
    expect(copies()[0].mail.html_body).toBe('<p>Words</p>')
    expect(composer.saveState.value.status).toBe('failed')
  })

  it('does not report sent or close on any answer but Submitted', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValueOnce({ id: 'draft-1', status: 'Failed', error: null })
    await composer.sendMail()
    expect(open).toBe(true)
    expect(raiseToast).not.toHaveBeenCalledWith('Message sent.', expect.anything())
  })

  it('leaves nothing behind once sent', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(networkDown())
    composer.mail.html_body = '<p>Words</p>'
    await composer.saveDraft()
    expect(copies()).toHaveLength(1)

    server.updateDraft.mockResolvedValueOnce(sent)
    await composer.sendMail()
    expect(copies()).toEqual([])

    server.updateDraft.mockClear()
    await vi.advanceTimersByTimeAsync(120_000)
    await composer.leave()
    expect(server.updateDraft).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('includes an address typed but not yet made into a recipient', async () => {
    const composer = compose(draft, {
      commitTypedRecipients: () => composer.mail.to.push({ email: 'typed@example.com' }),
    })
    server.updateDraft.mockResolvedValue(sent)
    await composer.sendMail()
    expect(server.updateDraft.mock.calls[0][0].to).toContainEqual({ email: 'typed@example.com' })
  })

  it('waits for attachments', async () => {
    const composer = compose()
    const upload = deferred()
    void composer.trackUpload('brief.pdf', upload.promise)
    await composer.sendMail()
    expect(server.updateDraft).not.toHaveBeenCalled()
    expect(open).toBe(true)
  })

  it('does not send a draft that was sent, discarded or saved over elsewhere', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(noSuchDraft())
    await composer.sendMail()
    expect(open).toBe(true)
    expect(composer.saveState.value.status).toBe('gone')

    server.updateDraft.mockClear()
    server.create.mockClear()
    await composer.sendMail()
    expect(server.updateDraft).not.toHaveBeenCalled()
    expect(server.create).not.toHaveBeenCalled()
  })
})

describe('a draft gone from the server', () => {
  const goneComposer = async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(noSuchDraft())
    composer.mail.html_body = '<p>Mine</p>'
    await composer.saveDraft()
    return composer
  }

  it('keeps the text and stops writing', async () => {
    const composer = await goneComposer()
    expect(composer.saveState.value.status).toBe('gone')
    expect(composer.mail.html_body).toBe('<p>Mine</p>')
    expect(copies()[0].mail.html_body).toBe('<p>Mine</p>')
    server.updateDraft.mockClear()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(server.updateDraft).not.toHaveBeenCalled()
  })

  it('becomes a separate new draft when kept, leaving the other alone', async () => {
    const composer = await goneComposer()
    const oldKey = composer.mail.draft_key
    server.create.mockResolvedValueOnce(saved('new-1'))
    await composer.keepAsNewDraft()

    expect(server.create).toHaveBeenCalledOnce()
    const [input] = server.create.mock.calls[0]
    expect(input).toMatchObject({ html_body: '<p>Mine</p>', save_as_draft: true })
    expect(input.draft_key).not.toBe(oldKey)
    expect(composer.mail.id).toBe('new-1')
    expect(composer.saveState.value.status).toBe('saved')
    expect(copies()).toEqual([])
  })

  it('has nothing on the server to remove when discarded', async () => {
    const composer = await goneComposer()
    await composer.discardMail()
    expect(commitAfterUndo.mock.calls[0][0].removal).toEqual({ kind: 'messages', names: [] })
    expect(copies()).toEqual([])
  })
})

describe('leaving', () => {
  it('saves on the way out', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValue(saved('draft-2'))
    composer.mail.html_body = '<p>Last words.</p>'
    open = false
    await composer.leave()
    expect(server.updateDraft.mock.calls[0][0].html_body).toBe('<p>Last words.</p>')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('keeps a draft whose save on close was refused, ready to reopen', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(new Error('Attachment is not a site file'))
    composer.mail.html_body = '<p>Last words.</p>'
    open = false
    await composer.leave()
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

  it('goes on trying off screen, and clears everything when it lands', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValueOnce(networkDown())
    composer.mail.html_body = '<p>Last words.</p>'
    open = false
    await composer.leave()
    expect(copies()).toHaveLength(1)

    server.updateDraft.mockResolvedValueOnce(saved('draft-2'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(server.updateDraft).toHaveBeenCalledTimes(2)
    expect(copies()).toEqual([])
    expect(toastDismiss).toHaveBeenCalledWith('toast-id')
    expect(raiseToast).toHaveBeenCalledWith('Draft saved.')

    server.updateDraft.mockClear()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(server.updateDraft).not.toHaveBeenCalled()
  })

  it('stops trying when the draft is reopened from the toast', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    composer.mail.html_body = '<p>Last words.</p>'
    open = false
    await composer.leave()
    const [, options] = toastError.mock.calls[0]
    options.action.onClick()
    server.updateDraft.mockClear()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(server.updateDraft).not.toHaveBeenCalled()
  })

  it('waits for a file still uploading, then saves it with the draft', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValue(saved('draft-2'))
    const upload = deferred()
    void composer.trackUpload(
      'brief.pdf',
      upload.promise.then(() => composer.mail.attachments.push(uploaded('/f/b.pdf'))),
    )
    composer.mail.html_body = '<p>See attached</p>'
    open = false
    const leaving = composer.leave()
    await tick()
    expect(server.updateDraft).not.toHaveBeenCalled()

    upload.resolve(undefined)
    await leaving
    expect(server.updateDraft.mock.calls.at(-1)![0].attachments).toEqual([uploaded('/f/b.pdf')])
  })

  it('still saves the file when an earlier save lands while it uploads', async () => {
    const composer = compose()
    // As sent: the composer goes on pushing to the same list after a write.
    const sent: unknown[] = []
    server.updateDraft.mockImplementation(async (input: { attachments: unknown[] }) => {
      sent.push(JSON.parse(JSON.stringify(input.attachments)))
      return saved('draft-2')
    })
    const upload = deferred()
    void composer.trackUpload(
      'brief.pdf',
      upload.promise.then(() => composer.mail.attachments.push(uploaded('/f/b.pdf'))),
    )
    composer.mail.html_body = '<p>See attached</p>'
    await tick()
    open = false
    const leaving = composer.leave()
    // The edit's own save, on its usual delay, lands before the file does.
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toEqual([[]])

    upload.resolve(undefined)
    await leaving
    expect(sent.at(-1)).toEqual([uploaded('/f/b.pdf')])
  })

  it('a composition with a file uploading is not an untouched one', async () => {
    const composer = compose({})
    expect(composer.isUntouched.value).toBe(true)
    void composer.trackUpload('brief.pdf', new Promise(() => {}))
    expect(composer.isUntouched.value).toBe(false)
  })

  it('hands unsaved text to the next composer, which saves it on opening', async () => {
    const composer = compose()
    composer.mail.html_body = '<p>Unsaved</p>'
    await nextTick()
    const handed = JSON.parse(JSON.stringify(composer.handOff()))
    expect(handed.restored).toBe(true)
    expect(handed.draft_key).toBe(composer.mail.draft_key)

    server.updateDraft.mockResolvedValue(saved('draft-2'))
    const next = compose(handed)
    await tick()
    expect(server.updateDraft).toHaveBeenCalledOnce()
    expect(server.updateDraft.mock.calls[0][0].draft_key).toBe(handed.draft_key)
    expect(next.saveState.value.status).toBe('saved')
  })

  it('hands over saved text without another save', async () => {
    const composer = compose()
    const handed = JSON.parse(JSON.stringify(composer.handOff()))
    expect(handed.restored).toBe(false)
    compose(handed)
    await tick()
    expect(server.updateDraft).not.toHaveBeenCalled()
  })

  it('warns before the page closes while text is only on screen', async () => {
    const composer = compose()
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(unload()).toBe(false)

    server.updateDraft.mockResolvedValue(saved('draft-2'))
    composer.mail.html_body = '<p>Words</p>'
    await nextTick()
    expect(unload()).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(unload()).toBe(false)
  })

  it('does not warn once a failed save is kept on the device', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    composer.mail.html_body = '<p>Words</p>'
    await composer.saveDraft()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('warns while a file is uploading', async () => {
    const composer = compose()
    void composer.trackUpload('brief.pdf', new Promise(() => {}))
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('saves as the page is put away, with a request that outlives it', async () => {
    const composer = compose()
    server.updateDraft.mockResolvedValue(saved('draft-2'))
    composer.mail.html_body = '<p>Words</p>'
    await nextTick()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    vi.restoreAllMocks()
    expect(server.updateDraft.mock.calls[0][1]).toMatchObject({ keepalive: true })
  })

  it('removes the copy when discarded', async () => {
    const composer = compose()
    server.updateDraft.mockRejectedValue(networkDown())
    composer.mail.html_body = '<p>Words</p>'
    await composer.saveDraft()
    await composer.discardMail()
    expect(copies()).toEqual([])
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
