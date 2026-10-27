import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { errors } from './comment-list-fakes'
import {
  buttonNamed,
  click,
  labelled,
  letHandlersAttach,
  LONGEST,
  openRows,
  rowButton,
  settled,
  showList,
  TOO_LONG,
  TOO_LONG_MESSAGE,
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

describe('replying in an open thread', () => {
  function replyBox() {
    return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')
  }

  async function type(text: string) {
    replyBox()!.value = text
    replyBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  async function press(options: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...options })
    await letHandlersAttach()
    replyBox()!.dispatchEvent(event)
    await settled()
    return event.defaultPrevented
  }

  it('puts the cursor in the reply box of a thread opened from the list', async () => {
    const { host } = showList()

    await click(rowButton(host, 'Is this right?'))
    await nextTick()

    expect([replyBox(), document.activeElement === replyBox()]).toEqual([expect.anything(), true])
  })

  it('leaves the cursor where it was when the thread is opened from its text', async () => {
    showList({ openThread: 'on-text' })
    await settled()

    expect([replyBox(), document.activeElement === replyBox()]).toEqual([expect.anything(), false])
  })

  it('sends the reply on Enter and empties the box', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type('  Agreed ')
    const isKeptOutOfBox = await press({})

    expect([asked, replyBox()?.value, isKeptOutOfBox]).toEqual([
      ['reply on-text "Agreed"'],
      '',
      true,
    ])
  })

  // Replies that wait until released, as on a slow network
  function holdReplies() {
    const held = { release() {} }
    const heldReplies = new Promise<void>((resolve) => {
      held.release = resolve
    })
    function release() {
      held.release()
    }

    return { heldReplies, release }
  }

  it('keeps the words typed while a reply sends, and empties only what was sent', async () => {
    const { heldReplies, release } = holdReplies()
    const { host, asked } = showList({ heldReplies })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    await press({})
    await type('Agreed. One more thing')
    release()
    await settled()

    expect([asked, replyBox()?.value]).toEqual([['reply on-text "Agreed"'], '. One more thing'])
  })

  it('keeps the whole box when the words being sent are changed while they send', async () => {
    const { heldReplies, release } = holdReplies()
    const { host } = showList({ heldReplies })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    await press({})
    await type('Agree, mostly')
    release()
    await settled()

    expect(replyBox()?.value).toBe('Agree, mostly')
  })

  it('sends nothing on Shift+Enter or while a word is being composed', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type('Agreed')
    const pressed = [
      await press({ shiftKey: true }),
      await press({ isComposing: true }),
      await press({ keyCode: 229 }),
    ]

    expect([asked, pressed]).toEqual([[], [false, false, false]])
  })

  it('sends nothing on Enter while the people list is open', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type('Ask @z')
    const isKeptOutOfBox = await press({})

    expect([asked, replyBox()?.value, isKeptOutOfBox]).toEqual([[], 'Ask @z', true])
  })

  it('sends one reply for two quick presses of Enter', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    const enter = { key: 'Enter', cancelable: true }
    await letHandlersAttach()
    replyBox()!.dispatchEvent(new KeyboardEvent('keydown', enter))
    replyBox()!.dispatchEvent(new KeyboardEvent('keydown', enter))
    await settled()

    expect(asked).toEqual(['reply on-text "Agreed"'])
  })

  it('sends the same words again under the same client id after a refusal, so Drive posts them once', async () => {
    const { host, asked, replyIds } = showList({ refusedReplies: 1 })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')

    await press({})
    const kept = replyBox()?.value
    await press({})

    const [first, second] = replyIds
    expect([asked, kept, replyIds.length, first === second]).toEqual([
      ['reply on-text "Agreed"', 'reply on-text "Agreed"'],
      'Agreed',
      2,
      true,
    ])
  })

  it('sends changed words after a refusal under a new client id', async () => {
    const { host, replyIds } = showList({ refusedReplies: 1 })
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')
    await press({})

    await type('Agreed, mostly')
    await press({})

    const [first, second] = replyIds
    expect([replyIds.length, first === second]).toEqual([2, false])
  })

  it('sends earlier refused words again under their first client id, after other words in between', async () => {
    const { host, replyIds } = showList({ refusedReplies: 2 })
    await click(rowButton(host, 'Is this right?'))

    for (const words of ['Agreed', 'Not sure', 'Agreed']) {
      await type(words)
      await press({})
    }

    const [first, second, third] = replyIds
    expect([replyIds.length, first === third, first === second]).toEqual([3, true, false])
  })

  it('gives a new reply of the same words its own client id once the last one is posted', async () => {
    const { host, replyIds } = showList()
    await click(rowButton(host, 'Is this right?'))
    await type('Agreed')
    await press({})

    await type('Agreed')
    await press({})

    const [first, second] = replyIds
    expect([replyIds.length, first === second]).toEqual([2, false])
  })

  it('sends no reply over the limit, keeping its words and saying why, but sends one at it', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    await type(TOO_LONG)
    await press({})
    const isKept = replyBox()?.value === TOO_LONG
    await type(LONGEST)
    await press({})

    expect([isKept, errors, asked.length, asked[0] === `reply on-text "${LONGEST}"`]).toEqual([
      true,
      [TOO_LONG_MESSAGE],
      1,
      true,
    ])
  })

  it('shows the send arrow only once there is text, and sends from it', async () => {
    const { host, asked } = showList()
    await click(rowButton(host, 'Is this right?'))

    const isShownEmpty = !!labelled(host, 'Send reply')
    await type('Agreed')
    await click(labelled(host, 'Send reply'))
    await settled()

    expect([isShownEmpty, asked]).toEqual([false, ['reply on-text "Agreed"']])
  })

  it('keeps the thread open with its words when Drive refuses to resolve it', async () => {
    const { host } = showList({ isRefusingResolve: true })
    await click(rowButton(host, 'Looks good overall'))
    await type('Half a reply')

    await click(
      host.querySelector<HTMLButtonElement>(
        'li[data-thread="whole"] button[aria-label="Resolve"]',
      ) ?? undefined,
    )
    await settled()

    expect([openRows(host), replyBox()?.value]).toEqual([['whole'], 'Half a reply'])
  })

  it('keeps a half-typed reply when another thread is opened and back', async () => {
    const { host } = showList()
    await click(rowButton(host, 'Is this right?'))
    await type('Half a reply')

    await click(rowButton(host, 'Looks good overall'))
    const otherBox = replyBox()?.value
    await click(rowButton(host, 'Is this right?'))

    expect([otherBox, replyBox()?.value]).toEqual(['', 'Half a reply'])
  })

  it('offers no reply box in a resolved thread', async () => {
    const { host } = showList()

    await click(buttonNamed(host, 'Resolved · 1'))
    await click(rowButton(host, 'Fixed the title'))

    expect(replyBox()).toBeNull()
  })
})
