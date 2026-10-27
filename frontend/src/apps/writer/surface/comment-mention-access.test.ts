import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { DocumentThread } from '@/apps/drive'

import { access } from './comment-list-fakes'
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

  // Answers the dialog the list is showing, and says what it offered
  async function answer(label: string) {
    const [dialog] = access.dialogs.splice(0)
    const offered = dialog!.actions.map((action) => action.label)
    await dialog!.actions.find((action) => action.label === label)!.onClick?.()
    await settled()
    return [dialog!.title, offered]
  }

  it('asks before posting, and Share and post shares at View before it posts', async () => {
    access.locked = ['arjun@x.com']
    const { list, posted } = fakeDrafts()
    const { host } = showList({ drafts: list })
    await click(buttonNamed(host, 'Add a comment'))
    await write('Add a comment', 'Check this @[arjun@x.com] and @[ben@x.com]')

    await send('Add a comment')
    const postedWhileAsked = [...posted]
    const asked = await answer('Share and post')

    expect([postedWhileAsked, asked, access.shared, posted]).toEqual([
      [],
      ['arjun can’t open this document', ['Cancel', 'Post without sharing', 'Share and post']],
      [['arjun@x.com']],
      ['draft-0'],
    ])
  })

  it('keeps a reply on Cancel, and posts it unshared on Post without sharing', async () => {
    access.locked = ['arjun@x.com']
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await write('Reply', 'Over to @[arjun@x.com]')

    await send('Reply')
    await answer('Cancel')
    const afterCancel = [[...asked], box('Reply')?.value]
    await send('Reply')
    await answer('Post without sharing')

    expect([afterCancel, asked, access.shared]).toEqual([
      [[], 'Over to @[arjun@x.com]'],
      ['reply on-text "Over to @[arjun@x.com]"'],
      [],
    ])
  })

  it('posts without asking when everyone named can open the document', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await write('Reply', 'Over to @[ben@x.com]')

    await send('Reply')

    expect([access.dialogs, asked]).toEqual([[], ['reply on-text "Over to @[ben@x.com]"']])
  })

  it('asks about an edit only for the people it adds, offering only Post anyway without Manage', async () => {
    access.locked = ['ben@x.com', 'arjun@x.com']
    const asking = {
      ...WHOLE,
      comments: [{ ...comment('c8', 'Asha Rao', 'Ask @[ben@x.com]'), mentions: ['ben@x.com'] }],
    } as unknown as DocumentThread
    const { host, asked } = showList({ threads: [asking], canShare: false })
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
    const offered = await answer('Post anyway')

    expect([offered, asked, access.shared]).toEqual([
      ['arjun can’t open this document', ['Cancel', 'Post anyway']],
      ['edit c8 "Ask @[ben@x.com] and @[arjun@x.com]"'],
      [],
    ])
  })
})
