import { describe, expect, it, vi } from 'vitest'
import { createRelativePositionFromTypeIndex, Doc, XmlText } from 'yjs'

import { encodeAnchor } from '@/apps/writer/collab/anchors'

import { confirmed } from './comment-list-fakes'
import {
  buttonNamed,
  click,
  fakeDrafts,
  rows,
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

describe('comments not yet posted', () => {
  function menus(host: Element) {
    return host.querySelectorAll('button[aria-label="More comment actions"]').length
  }

  it('shows a comment being written above the list, and sent ones as the first rows', () => {
    const { list } = fakeDrafts([
      { text: 'Still writing' },
      { text: 'On its way', isSent: true, isPosting: true },
      { text: 'Refused', isSent: true },
    ])
    const { host } = showList({ threads: [WHOLE], drafts: list })
    const box = host.querySelector('textarea[aria-label="Add a comment on the text"]')!
    const isBoxFirst = !!(
      box.compareDocumentPosition(host.querySelector('ul')!) & Node.DOCUMENT_POSITION_FOLLOWING
    )
    const faded = [...host.querySelectorAll('li')].map((row) =>
      row.classList.contains('opacity-60'),
    )
    const boxes = host.querySelectorAll('textarea').length

    const isFocused = document.activeElement === box

    expect([
      (box as HTMLTextAreaElement).value,
      boxes,
      isFocused,
      isBoxFirst,
      rows(host),
      faded,
    ]).toEqual([
      'Still writing',
      1,
      true,
      true,
      [
        'You Posting… On its way',
        'You Not posted · Retry Refused',
        expect.stringMatching(/^Ben Ito .* Looks good overall$/),
      ],
      [true, false, false],
    ])
  })

  it('posts from the box and retries from Retry, opening the thread once Drive takes it', async () => {
    const { list, posted } = fakeDrafts(
      [{ text: 'New words' }, { text: 'Refused', isSent: true }],
      [null, 'thread-9'],
    )
    const { host, opened } = showList({ drafts: list, openThread: 'whole' })

    host.querySelector('form')!.requestSubmit()
    await settled()
    await click(buttonNamed(host, 'Retry'))
    await settled()

    expect([posted, opened]).toEqual([['draft-0', 'draft-1'], ['thread-9']])
  })

  it('discards a refused comment from its ⋯ only once confirmed, and offers no ⋯ while posting', async () => {
    const { list } = fakeDrafts([
      { text: 'On its way', isSent: true, isPosting: true },
      { text: 'Refused', isSent: true },
    ])
    const { host } = showList({ threads: [], drafts: list })
    function discard() {
      return host.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    }

    for (const toggle of host.querySelectorAll<HTMLButtonElement>('li button[aria-expanded]')) {
      await click(toggle)
    }

    const shownMenus = menus(host)
    confirmed.answer = false
    await click(discard())
    await settled()
    const afterNo = rows(host).length
    confirmed.answer = true
    await click(discard())
    await settled()

    expect([shownMenus, confirmed.asked, afterNo, rows(host)]).toEqual([
      1,
      ['Discard this comment?', 'Discard this comment?'],
      2,
      ['You Posting… On its way'],
    ])
  })

  it('opens a refused comment to its words on a click, and closes it on another', async () => {
    const content = new XmlText()
    new Doc().getXmlFragment('default').insert(0, [content])
    content.insert(0, 'the quoted words')
    const anchor = encodeAnchor(
      createRelativePositionFromTypeIndex(content, 0, 0),
      createRelativePositionFromTypeIndex(content, content.length, -1),
      'the quoted words',
    )
    const { list } = fakeDrafts([{ anchor, text: 'Refused', isSent: true }])
    const { host } = showList({ threads: [], drafts: list })

    await click(buttonNamed(host, 'You'))
    const [openRow] = rows(host)
    await click(buttonNamed(host, 'You'))
    const [closedRow] = rows(host)

    expect([openRow, closedRow]).toEqual([
      'You Not posted · Retry the quoted words Refused Discard',
      'You Not posted · Retry the quoted words Refused',
    ])
  })

  it('keeps unposted comments at the top, above Resolved', async () => {
    const { list } = fakeDrafts([{ text: 'Still writing' }, { text: 'Refused', isSent: true }])
    const { host } = showList({ drafts: list })

    await click(buttonNamed(host, 'Resolved · 1'))

    expect([!!host.querySelector('textarea'), rows(host)]).toEqual([
      true,
      [
        'You Not posted · Retry Refused',
        expect.stringMatching(/^Ben Ito \S.* Looks good overall$/),
        expect.stringMatching(/^Asha Rao \S.* Is this right\? · 2 replies$/),
        expect.stringMatching(/^Asha Rao Text deleted .* Fixed the title · 1 reply$/),
      ],
    ])
  })
})
