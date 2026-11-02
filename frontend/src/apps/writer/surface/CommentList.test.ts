import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { DocumentThread } from '@/apps/drive'

import { toasts } from './comment-list-fakes'
import {
  buttonNamed,
  click,
  comment,
  DONE,
  fakeDrafts,
  labelled,
  mounted,
  ON_TEXT,
  openRows,
  rowButton,
  rows,
  setMounted,
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

describe('the comments list', () => {
  it('shows each open thread on one row: who, where, when, the first comment and the replies', () => {
    const { host } = showList()

    expect(rows(host)).toEqual([
      expect.stringMatching(/^Ben Ito \S.* Looks good overall$/),
      expect.stringMatching(/^Asha Rao \S.* Is this right\? · 2 replies$/),
    ])
  })

  it('shows open threads, then resolved ones folded under Resolved · n', async () => {
    const { host } = showList()
    const atFirst = [
      rows(host).length,
      buttonNamed(host, 'Resolved · 1')?.getAttribute('aria-expanded'),
    ]

    await click(buttonNamed(host, 'Resolved · 1'))

    expect([
      atFirst,
      buttonNamed(host, 'Resolved · 1')?.getAttribute('aria-expanded'),
      rows(host),
    ]).toEqual([
      [2, 'false'],
      'true',
      [
        expect.stringMatching(/^Ben Ito \S.* Looks good overall$/),
        expect.stringMatching(/^Asha Rao \S.* Is this right\? · 2 replies$/),
        expect.stringMatching(/^Asha Rao Text deleted \S.* Fixed the title · 1 reply$/),
      ],
    ])
  })

  it('shows no Resolved line when nothing is resolved', () => {
    const { host } = showList({ threads: [ON_TEXT, WHOLE] })

    expect(host.textContent).not.toContain('Resolved')
  })

  it('keeps one thread open at a time, and closes it on a second click or Esc', async () => {
    const { host } = showList()
    const seen: string[][] = []

    await click(rowButton(host, 'Looks good overall'))
    seen.push(openRows(host))
    await click(rowButton(host, 'Is this right?'))
    seen.push(openRows(host))
    await click(rowButton(host, 'Is this right?'))
    seen.push(openRows(host))
    await click(rowButton(host, 'Looks good overall'))
    host.firstElementChild!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    seen.push(openRows(host))

    expect(seen).toEqual([['whole'], ['on-text'], [], []])
  })

  it('closes the open thread once another tab deletes it', async () => {
    const { host, opened, listed } = showList()

    await click(rowButton(host, 'Is this right?'))
    listed.value = [WHOLE, DONE]
    await nextTick()

    expect(opened).toEqual(['on-text', null])
  })

  it('closes the open thread once another tab resolves it', async () => {
    const { host, opened, listed } = showList()

    await click(rowButton(host, 'Is this right?'))
    listed.value = [{ ...ON_TEXT, resolved: true }, WHOLE, DONE]
    await nextTick()

    expect([opened, buttonNamed(host, 'Resolved · 2')?.getAttribute('aria-expanded')]).toEqual([
      ['on-text', null],
      'false',
    ])
  })

  it('keeps focus on the Resolved line while another tab changes the resolved threads', async () => {
    const { host, listed } = showList()
    const focused: (string | undefined)[] = []

    buttonNamed(host, 'Resolved · 1')!.focus()
    for (const threads of [
      [ON_TEXT, { ...WHOLE, resolved: true }, DONE],
      [ON_TEXT, WHOLE, DONE],
      [{ ...ON_TEXT, resolved: true }, WHOLE, DONE],
    ]) {
      listed.value = threads
      await nextTick()
      focused.push(document.activeElement?.textContent?.trim())
    }

    expect(focused).toEqual(['Resolved · 2', 'Resolved · 1', 'Resolved · 2'])
  })

  it('closes the open thread when it is resolved with Resolved unfolded', async () => {
    const { host, opened } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Is this right?'))
    await click(labelled(rowButton(host, 'Is this right?').parentElement!, 'Resolve'))
    await settled()

    expect(opened).toEqual(['on-text', null])
  })

  it('closes an open resolved thread when Resolved is folded', async () => {
    const { host, opened } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))
    await click(buttonNamed(host, 'Resolved · 1'))

    expect(opened).toEqual(['done', null])
  })

  it('keeps open a thread the list has not caught up with yet', async () => {
    const { opened, listed } = showList({ openThread: 'just-posted' })

    listed.value = [ON_TEXT, WHOLE]
    await nextTick()

    expect(opened).toEqual([])
  })

  it('shows an open thread’s quote and every reply', async () => {
    const { host } = showList()

    await click(rowButton(host, 'Is this right?'))
    const text = host.querySelector('li')!.parentElement!.textContent

    expect([text, text?.includes('2 replies')]).toEqual([
      expect.stringMatching(/the words.*Is this right\?.*Ben Ito.*Yes.*Asha Rao.*Thanks/s),
      false,
    ])
  })
})

describe('an empty list and a reader who can’t comment', () => {
  it('says how to start a comment when nothing is open', () => {
    const { host } = showList({ threads: [DONE] })

    expect(host.textContent).toContain(
      'No open comments. Select text and press Comment, or add one above.',
    )
  })

  it('offers a reader no top line, reply, resolve or delete, open or resolved', async () => {
    const { host } = showList({ canComment: false, threads: [ON_TEXT, DONE] })
    function extras() {
      const labels = [...host.querySelectorAll('button:not([aria-expanded])')].map(
        (button) => button.textContent?.trim() || button.getAttribute('aria-label'),
      )
      return [host.querySelector('textarea'), labels]
    }

    await click(rowButton(host, 'Is this right?'))
    const inOpen = extras()
    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))

    expect([inOpen, extras()]).toEqual([
      [null, []],
      [null, []],
    ])
  })

  it('shows No open comments, then Resolved · n, when every thread is resolved', () => {
    const { host } = showList({ threads: [DONE] })

    expect(host.textContent).toMatch(/No open comments\..*Resolved · 1/)
  })

  it('tells a reader only that nothing is open', () => {
    const { host } = showList({ canComment: false, threads: [] })

    expect(host.querySelector('p')?.textContent).toBe('No open comments.')
  })
})

describe('the list and the editor', () => {
  function point(host: Element, text: string, event: 'mouseenter' | 'mouseleave') {
    rowButton(host, text).parentElement!.dispatchEvent(new MouseEvent(event))
  }

  it('lights a thread’s text while its row is pointed at, and clears it after', () => {
    const { host, lit } = showList()

    point(host, 'Is this right?', 'mouseenter')
    point(host, 'Is this right?', 'mouseleave')

    expect(lit).toEqual(['on-text', null])
  })

  it('unfolds Resolved for a resolved thread opened from its text', async () => {
    const { host } = showList({ openThread: 'done' })
    await settled()

    const isOpen = rowButton(host, 'Fixed the title').getAttribute('aria-expanded')
    expect([buttonNamed(host, 'Resolved · 1')?.getAttribute('aria-expanded'), isOpen]).toEqual([
      'true',
      'true',
    ])
  })

  it('leaves no text lit once the panel closes', () => {
    const { host, opened, lit } = showList({ openThread: 'on-text' })
    point(host, 'Looks good overall', 'mouseenter')

    mounted!.unmount()
    setMounted(null)

    expect([opened, lit]).toEqual([[null], ['whole', null]])
  })
})

describe('threads changed since last opened', () => {
  function unreadRows(host: Element) {
    return rows(host).filter((row) => row.includes('Unread'))
  }

  function withReply(thread: DocumentThread) {
    const reply = { ...comment('c9', 'Ben Ito', 'One more'), modified: '2026-10-02 09:00:00' }
    return { ...thread, comments: [...thread.comments, reply] } as DocumentThread
  }

  it('dots a row changed since, open or resolved, and clears it once opened, never dotting drafts', async () => {
    const { list } = fakeDrafts([{ text: 'Refused', isSent: true }])
    const { host, listed } = showList({ drafts: list })
    const atFirst = unreadRows(host)

    listed.value = [ON_TEXT, withReply(WHOLE), withReply(DONE)]
    await nextTick()
    const changed = unreadRows(host)
    await click(rowButton(host, 'Looks good overall'))
    const opened = unreadRows(host)
    await click(buttonNamed(host, 'Resolved · 1'))
    const resolved = unreadRows(host)

    expect([atFirst, changed, opened, resolved]).toEqual([
      [],
      [expect.stringMatching(/^Ben Ito Unread \S.* Looks good overall · 1 reply$/)],
      [],
      [expect.stringMatching(/^Asha Rao Text deleted Unread \S.* Fixed the title · 2 replies$/)],
    ])
  })

  it('leaves a thread one resolves or reopens oneself unmarked', async () => {
    const { host } = showList()
    await click(rowButton(host, 'Looks good overall'))

    await click(labelled(host, 'Resolve'))
    await settled()
    await click(buttonNamed(host, 'Resolved · 2'))
    const afterResolve = [rows(host).length, unreadRows(host)]
    toasts[0].action.onClick()
    await settled()

    expect([afterResolve, rows(host).length, unreadRows(host)]).toEqual([[3, []], 3, []])
  })
})

describe('people a comment mentions', () => {
  const ASKING = {
    ...WHOLE,
    comments: [
      { ...comment('c8', 'Asha Rao', 'Ask @[ben@x.com] or @[ghost]'), mentions: ['ben@x.com'] },
    ],
  } as unknown as DocumentThread

  it('names the people Drive found mentioned, in the row and the open thread, and leaves the rest as written', async () => {
    const { host } = showList({ threads: [ASKING] })
    const closed = rows(host)

    await click(rowButton(host, 'Ask'))

    expect([closed, rows(host)]).toEqual([
      [expect.stringMatching(/Ask @Ben Roy or @\[ghost\]$/)],
      [expect.stringMatching(/Ask @Ben Roy or @\[ghost\]/)],
    ])
  })

  it('names a person Drive found mentioned whatever the case of their token', () => {
    const { host } = showList({
      threads: [
        {
          ...WHOLE,
          comments: [
            {
              ...comment('c9', 'Asha Rao', 'Ask @[BEN@x.com] or @[ghost]'),
              mentions: ['ben@x.com'],
            },
          ],
        } as unknown as DocumentThread,
      ],
    })

    expect(rows(host)).toEqual([expect.stringMatching(/Ask @Ben Roy or @\[ghost\]$/)])
  })

  it('names them the same in comments posting and not posted, closed and open', async () => {
    const { list } = fakeDrafts([
      { text: 'Ask @[ben@x.com]', isSent: true, isPosting: true },
      { text: 'Ask @[ben@x.com]', isSent: true },
    ])
    const { host } = showList({ threads: [], drafts: list })
    const closed = rows(host)

    const [, notPosted] = [...host.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'You',
    )
    await click(notPosted)

    expect([closed, rows(host)]).toEqual([
      ['You Posting… Ask @Ben Roy', 'You Not posted · Retry Ask @Ben Roy'],
      ['You Posting… Ask @Ben Roy', 'You Not posted · Retry Ask @Ben Roy Discard'],
    ])
  })
})

describe('a comment kept from the old Drive', () => {
  const PHOTO = { full_name: 'Asha Rao', user_image: '/asha.png' }
  const KEPT = {
    ...WHOLE,
    comments: [
      { ...comment('c9', 'Asha Rao', 'From 2023'), author_name: 'Old Name', person: PHOTO },
      { ...comment('c10', 'Asha Rao', 'Also 2023'), author_name: 'Other Name', person: PHOTO },
    ],
  } as unknown as DocumentThread

  function avatars(host: Element) {
    return [...host.querySelectorAll('[data-avatar]')].map((avatar) => [
      avatar.getAttribute('data-avatar'),
      avatar.getAttribute('data-image'),
    ])
  }

  it('names the old commenter, with their initials and no photo', async () => {
    const { host } = showList({ threads: [KEPT] })
    const closed = rows(host)

    await click(rowButton(host, 'From 2023'))

    expect([closed, rows(host), avatars(host)]).toEqual([
      [expect.stringMatching(/^Old Name .*From 2023/)],
      [expect.stringMatching(/^Old Name .*From 2023.*Other Name .*Also 2023/s)],
      [['Other Name', 'none']],
    ])
  })

  it('names the person and shows their photo when no old name is kept', async () => {
    const SIGNED = {
      ...WHOLE,
      comments: [
        comment('c11', 'Asha Rao', 'Now'),
        {
          ...comment('c12', 'Ben Ito', 'Later'),
          person: { full_name: 'Ben Ito', user_image: '/ben.png' },
        },
      ],
    } as unknown as DocumentThread
    const { host } = showList({ threads: [SIGNED] })

    await click(rowButton(host, 'Now'))

    expect([rows(host), avatars(host)]).toEqual([
      [expect.stringMatching(/^Asha Rao .*Now.*Ben Ito .*Later/s)],
      [['Ben Ito', '/ben.png']],
    ])
  })

  it('names the person and shows their photo when the old name is blank', async () => {
    const BLANK = {
      ...WHOLE,
      comments: [
        { ...comment('c13', 'Asha Rao', 'Then'), author_name: ' ' },
        {
          ...comment('c14', 'Ben Ito', 'After'),
          author_name: '  ',
          person: { full_name: 'Ben Ito', user_image: '/ben.png' },
        },
      ],
    } as unknown as DocumentThread
    const { host } = showList({ threads: [BLANK] })

    await click(rowButton(host, 'Then'))

    expect([rows(host), avatars(host)]).toEqual([
      [expect.stringMatching(/^Asha Rao .*Then.*Ben Ito .*After/s)],
      [['Ben Ito', '/ben.png']],
    ])
  })
})
