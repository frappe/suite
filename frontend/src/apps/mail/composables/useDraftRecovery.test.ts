import { beforeEach, describe, expect, it, vi } from 'vitest'

import { writeDraftCopy, type DraftCopy } from '@/apps/mail/utils/draftCopies'

import { offerDraftCopies, withdrawDraftCopyOffer } from './useDraftRecovery'

type OfferOptions = {
  description: string
  action: { onClick: () => void }
  cancel: { onClick: () => void }
}
const toast = vi.hoisted(() => ({
  warning: vi.fn<(message: string, options: OfferOptions) => string>(() => 'offer'),
  dismiss: vi.fn(),
}))
vi.mock('frappe-ui', () => ({ toast }))
vi.stubGlobal('__', (text: string, args: string[] = []) =>
  args.reduce((result, arg, index) => result.replace(`{${index}}`, arg), text),
)

const USER = 'maya@example.com'
const copy = (over: Partial<DraftCopy> = {}): DraftCopy => ({
  key: 'k1',
  user: USER,
  account: 'a1',
  ids: ['draft-2', 'draft-1'],
  savedAt: Date.now(),
  uploading: [],
  mail: {
    to: [{ email: 'dana@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Hello',
    html_body: '<p>Hi</p>',
    quoted_content: '',
    attachments: [],
    in_reply_to: '',
    in_reply_to_id: '',
    forwarded_from_id: '',
  },
  ...over,
})
const offered = () => toast.warning.mock.calls

beforeEach(() => {
  localStorage.clear()
  toast.warning.mockClear()
  toast.dismiss.mockClear()
})

describe('offering local copies back', () => {
  it('offers nothing when there is nothing', async () => {
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen: vi.fn() })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('reopens on top of the id it was written on, and to be saved', async () => {
    writeDraftCopy(copy())
    const reopen = vi.fn()
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen })

    expect(offered()[0][0]).toContain('Hello')
    offered()[0][1].action.onClick()
    expect(reopen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'draft-2',
        draft_key: 'k1',
        account: 'a1',
        restored: true,
        composed: true,
        html_body: '<p>Hi</p>',
        to: [{ email: 'dana@example.com' }],
      }),
    )
  })

  it('removes the copy when discarded', async () => {
    writeDraftCopy(copy())
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen: vi.fn() })
    offered()[0][1].cancel.onClick()
    expect(localStorage.length).toBe(0)
  })

  it('says which files did not come along', async () => {
    writeDraftCopy(copy({ uploading: ['brief.pdf'] }))
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen: vi.fn() })
    expect(offered()[0][1].description).toContain('brief.pdf')
  })

  it("leaves other people's and other accounts' copies alone", async () => {
    writeDraftCopy(copy({ user: 'sam@example.com' }))
    writeDraftCopy(copy({ key: 'k2', account: 'gone-account' }))
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen: vi.fn() })
    expect(toast.warning).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(2)
  })

  it('leaves a copy a live composer still holds', async () => {
    writeDraftCopy(copy())
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { query: async () => ({ held: [{ name: 'suite.mail.draftCopy.v1:k1' }] }) },
    })
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen: vi.fn() })
    expect(toast.warning).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.stubGlobal('__', (text: string) => text)
  })

  it('does not bury the page in offers', async () => {
    for (const key of ['a', 'b', 'c', 'd', 'e']) writeDraftCopy(copy({ key }))
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen: vi.fn() })
    expect(toast.warning).toHaveBeenCalledTimes(3)
  })

  it('takes an offer back once the copy is dealt with elsewhere', async () => {
    writeDraftCopy(copy())
    await offerDraftCopies({ user: USER, accounts: ['a1'], reopen: vi.fn() })
    withdrawDraftCopyOffer('k1')
    expect(toast.dismiss).toHaveBeenCalledWith('offer')
  })
})
