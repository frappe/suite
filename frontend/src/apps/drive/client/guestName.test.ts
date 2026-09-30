import { beforeEach, describe, expect, it } from 'vitest'

import { createGuestCommentName } from './guestName'
import { createLinkStore } from './links'
import { createSession } from '@/platform/session'
import type { Transport } from '@/platform/transport'

/** A guest's browser: a link store on `localStorage` and a session nobody signed in to. */
function browser() {
  const session = createSession({ request: async () => ({}) } as unknown as Transport)
  const links = createLinkStore({ storage: localStorage, session })
  return { session, links, field: () => createGuestCommentName(links, session) }
}

beforeEach(() => localStorage.clear())

describe('the guest "Your name" field', () => {
  it('shows for a guest, sends the trimmed name, and prefills it on the next visit', () => {
    const { field } = browser()
    const first = field()
    first.text.value = '  Ravi (Acme)  '
    const sent = first.take()

    const next = field()

    expect([first.shown.value, sent, next.text.value]).toEqual([true, 'Ravi (Acme)', 'Ravi (Acme)'])
  })

  it('sends no name when the field is empty, and forgets the name kept before', () => {
    const { field } = browser()
    const first = field()
    first.text.value = 'Ravi'
    first.take()
    const second = field()
    second.text.value = '   '

    expect(second.take()).toBeUndefined()
    expect(field().text.value).toBe('')
  })

  it('says when the name reaches the 140 characters the server accepts', () => {
    const { field } = browser()
    const name = field()
    name.text.value = 'a'.repeat(139)
    const below = name.atLimit.value
    name.text.value = 'a'.repeat(140)

    expect([below, name.atLimit.value, name.maxLength.value]).toEqual([false, true, 140])
  })

  it('counts an emoji as one character, as the server does', () => {
    const { field } = browser()
    const name = field()
    name.text.value = '🙂'.repeat(139)
    const below = [name.atLimit.value, name.maxLength.value]
    name.text.value = '🙂'.repeat(140)

    // 139 emoji leave room for one more character: the input takes 278 UTF-16 units plus one.
    expect([...below, name.atLimit.value, name.maxLength.value]).toEqual([false, 279, true, 280])
  })

  it('hides for a signed-in user, sends nothing, and sign out clears the name', async () => {
    const { session, field } = browser()
    const asGuest = field()
    asGuest.text.value = 'Ravi'
    asGuest.take()

    await session.login('ravi@example.com', 'secret')
    const signedIn = field()
    signedIn.text.value = 'Someone else'
    const shown = signedIn.shown.value
    const sent = signedIn.take()
    await session.logout()

    expect([shown, sent]).toEqual([false, undefined])
    expect(field().text.value).toBe('')
    expect(localStorage.length).toBe(0)
  })
})
