import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { DocumentThread } from '@/apps/drive'

import { access, confirmed, toasts, warnings } from './comment-list-fakes'
import {
  buttonNamed,
  click,
  comment,
  fakeDrafts,
  rowButton,
  settled,
  showList,
  WHOLE,
} from './comment-list-fixtures'

vi.mock('@/platform/session', async () => {
  const { fakeSession } = await import('./comment-list-fakes')
  return fakeSession()
})

vi.mock('@/apps/writer/composables/useUsers', async () => {
  const { fakeUsers } = await import('./comment-list-fakes')
  return fakeUsers()
})

vi.mock('@/platform/feedback', async () => {
  const { fakeFeedback } = await import('./comment-list-fakes')
  return fakeFeedback()
})

vi.mock('frappe-ui', async () => {
  const { fakeFrappeUi } = await import('./comment-list-fakes')
  return fakeFrappeUi()
})

vi.mock('@/apps/drive', async () => {
  const { fakeDrive } = await import('./comment-list-fakes')
  return fakeDrive()
})

vi.mock('@/apps/writer/drive', async () => {
  const { fakeWriterDrive } = await import('./comment-list-fakes')
  return fakeWriterDrive()
})

describe('naming someone who can’t open the document', () => {
  function box(label: string) {
    return document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
  }

  async function write(label: string, text: string) {
    box(label)!.value = text
    box(label)!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  async function send(label: string) {
    box(label)!.closest('form')!.requestSubmit()
    await settled()
  }

  it('posts a manager’s mention at once and says who can now comment', async () => {
    access.locked = ['arjun@x.com']
    const { list, posted } = fakeDrafts([], ['thread-1'])
    const { host } = showList({ drafts: list })
    await click(buttonNamed(host, 'Add a comment'))
    await write('Add a comment', 'Check this @[arjun@x.com] and @[ben@x.com]')

    await send('Add a comment')

    expect([confirmed.asked, posted, toasts.map((toast) => toast.message)]).toEqual([
      [],
      ['draft-0'],
      ['arjun can now comment'],
    ])
  })

  it('tells a writer without Manage that the person still can’t open it', async () => {
    access.locked = ['arjun@x.com']
    const { host, asked } = showList({ canShare: false })
    await click(rowButton(host, 'Is this right?'))
    await write('Reply', 'Over to @[arjun@x.com]')

    await send('Reply')

    expect([confirmed.asked, asked, toasts, warnings]).toEqual([
      [],
      ['reply on-text "Over to @[arjun@x.com]"'],
      [],
      ['arjun can’t open this document until someone who manages it shares it'],
    ])
  })

  it('asks about a blocked person, keeps the reply on Cancel, and posts on Post anyway', async () => {
    access.locked = ['arjun@x.com']
    access.blocked = ['arjun@x.com']
    confirmed.answer = false
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await write('Reply', 'Over to @[arjun@x.com]')

    await send('Reply')
    const afterCancel = [[...asked], box('Reply')?.value]
    confirmed.answer = true
    await send('Reply')

    expect([confirmed.asked[0], afterCancel, asked, toasts, warnings]).toEqual([
      'arjun has been blocked from this document',
      [[], 'Over to @[arjun@x.com]'],
      ['reply on-text "Over to @[arjun@x.com]"'],
      [],
      [],
    ])
  })

  it('says nothing when everyone named can open the document', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await write('Reply', 'Over to @[ben@x.com]')

    await send('Reply')

    expect([confirmed.asked, asked, toasts, warnings]).toEqual([
      [],
      ['reply on-text "Over to @[ben@x.com]"'],
      [],
      [],
    ])
  })

  it('looks only at the people an edit adds', async () => {
    access.locked = ['ben@x.com', 'arjun@x.com']
    const asking = {
      ...WHOLE,
      comments: [{ ...comment('c8', 'Asha Rao', 'Ask @[ben@x.com]'), mentions: ['ben@x.com'] }],
    } as unknown as DocumentThread
    const { host, asked } = showList({ threads: [asking] })
    await click(rowButton(host, 'Ask'))
    const menu = host.querySelector<HTMLElement>('li button[aria-label="More comment actions"]')
    await click(menu!)
    await click(
      [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === 'Edit',
      ),
    )
    await nextTick()

    await write('Edit comment', 'Ask @[ben@x.com] and @[arjun@x.com]')
    await send('Edit comment')

    expect([asked, toasts.map((toast) => toast.message)]).toEqual([
      ['edit c8 "Ask @[ben@x.com] and @[arjun@x.com]"'],
      ['arjun can now comment'],
    ])
  })
})
