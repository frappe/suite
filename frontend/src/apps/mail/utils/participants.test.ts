import { beforeAll, describe, expect, it } from 'vitest'

import type { Mail, ThreadParticipant } from '@/apps/mail/types'

import { formatThreadParticipants, threadParticipants } from './participants'

// `__` is installed on window by the translation plugin at app boot; the util calls it at format time,
// so standing it up before the first test is enough.
beforeAll(() => {
  window.__ = (message: string) => message
})

const participant = (name: string, email: string, is_self = false): ThreadParticipant => ({
  name,
  email,
  is_self,
})

const message = (from_name: string, from_email: string) => ({ from_name, from_email }) as Mail

const own = new Set(['vibhav@frappe.io'])

describe('threadParticipants', () => {
  const names = (messages: Mail[]) => threadParticipants(messages, own).map((p) => p.name)

  it('lists senders in the order they first wrote', () => {
    const thread = [
      message('Sarfaraz Shaikh', 'sarfaraz@frappe.io'),
      message('Vibhav Katre', 'vibhav@frappe.io'),
      message('Sarfaraz Shaikh', 'sarfaraz@frappe.io'),
    ]
    expect(names(thread)).toEqual(['Sarfaraz Shaikh', 'Vibhav Katre'])
  })

  it("flags the account's own addresses, however they are cased", () => {
    const thread = [
      message('Sarfaraz Shaikh', 'sarfaraz@frappe.io'),
      message('Vibhav Katre', 'Vibhav@Frappe.io'),
    ]
    expect(threadParticipants(thread, own).map((p) => p.is_self)).toEqual([false, true])
  })

  it('keeps everyone writing from one relay address', () => {
    // Discourse sends every poster through noreply@, carrying the poster in the display name.
    const thread = [
      message('Jay1987', 'noreply@discuss.frappe.io'),
      message('M Umair Sayed', 'noreply@discuss.frappe.io'),
      message('Jay1987', 'noreply@discuss.frappe.io'),
    ]
    expect(names(thread)).toEqual(['Jay1987', 'M Umair Sayed'])
  })

  it('treats one name written two ways as one writer', () => {
    const thread = [
      message('Jay1987', 'noreply@discuss.frappe.io'),
      message('  jay1987 ', '  NoReply@Discuss.Frappe.io '),
    ]
    expect(names(thread)).toEqual(['Jay1987'])
  })

  it('does not take a nameless message for a second writer', () => {
    // It would be shown as the bare address, sat next to the names from that same address.
    const thread = [
      message('Jay1987', 'noreply@discuss.frappe.io'),
      message('', 'noreply@discuss.frappe.io'),
    ]
    expect(names(thread)).toEqual(['Jay1987'])
  })

  it('lets the first name adopt a nameless entry', () => {
    const thread = [
      message('', 'noreply@discuss.frappe.io'),
      message('M Umair Sayed', 'noreply@discuss.frappe.io'),
      message('Jay1987', 'noreply@discuss.frappe.io'),
    ]
    expect(names(thread)).toEqual(['M Umair Sayed', 'Jay1987'])
  })

  it('keeps a nameless sender named after their address', () => {
    const thread = [message('', 'noreply@frappe.io'), message('', 'alerts@uptimerobot.com')]
    expect(threadParticipants(thread, own).map((p) => p.email)).toEqual([
      'noreply@frappe.io',
      'alerts@uptimerobot.com',
    ])
  })

  it('skips messages with no sender', () => {
    expect(
      names([message('Nobody', ''), message('Sarfaraz Shaikh', 'sarfaraz@frappe.io')]),
    ).toEqual(['Sarfaraz Shaikh'])
  })

  it('has nothing to name for a row with no conversation behind it', () => {
    // Search results are single messages; their rows fall back to the sender they carry.
    expect(threadParticipants(undefined, own)).toEqual([])
  })
})

describe('formatThreadParticipants', () => {
  it('names a lone sender in full', () => {
    expect(formatThreadParticipants([participant('Sarfaraz Shaikh', 'sarfaraz@frappe.io')])).toBe(
      'Sarfaraz Shaikh',
    )
  })

  it('keeps the original sender ahead of the user who replied', () => {
    const thread = [
      participant('Sarfaraz Shaikh', 'sarfaraz@frappe.io'),
      participant('Vibhav Katre', 'vibhav@frappe.io', true),
    ]
    expect(formatThreadParticipants(thread)).toBe('Sarfaraz, me')
  })

  it('capitalizes "me" only where it heads the row', () => {
    const thread = [
      participant('Vibhav Katre', 'vibhav@frappe.io', true),
      participant('Sarfaraz Shaikh', 'sarfaraz@frappe.io'),
    ]
    expect(formatThreadParticipants(thread)).toBe('Me, Sarfaraz')
    expect(formatThreadParticipants([participant('Vibhav Katre', 'vibhav@frappe.io', true)])).toBe(
      'Me',
    )
  })

  it('says "me" once however many of the user\'s addresses wrote', () => {
    const thread = [
      participant('Sarfaraz Shaikh', 'sarfaraz@frappe.io'),
      participant('Vibhav Katre', 'vibhav@frappe.io', true),
      participant('Vibhav', 'vibhav@example.com', true),
    ]
    expect(formatThreadParticipants(thread)).toBe('Sarfaraz, me')
  })

  it('lists every name up to the limit', () => {
    const thread = [
      participant('Brittany Court', 'brittany@frappe.io'),
      participant('Milind Jain', 'milind@frappe.io'),
      participant('Vibhav Katre', 'vibhav@frappe.io', true),
    ]
    expect(formatThreadParticipants(thread)).toBe('Brittany, Milind, me')
  })

  it('elides as soon as the thread runs one name past the limit', () => {
    const thread = [
      participant('Brittany Court', 'brittany@frappe.io'),
      participant('Milind Jain', 'milind@frappe.io'),
      participant('Neha Sankhe', 'neha@frappe.io'),
      participant('Vibhav Katre', 'vibhav@frappe.io', true),
    ]
    expect(formatThreadParticipants(thread)).toBe('Brittany … Neha, me')
  })

  it('elides the middle of a long thread, keeping its ends', () => {
    const thread = [
      participant('Brittany Court', 'brittany@frappe.io'),
      participant('Milind Jain', 'milind@frappe.io'),
      participant('Neha Sankhe', 'neha@frappe.io'),
      participant('Courtney Diaz', 'courtney@frappe.io'),
      participant('Vibhav Katre', 'vibhav@frappe.io', true),
    ]
    expect(formatThreadParticipants(thread)).toBe('Brittany … Courtney, me')
  })

  it('keeps what follows an initial, which names nobody on its own', () => {
    const thread = [
      participant('Jay1987', 'noreply@discuss.frappe.io'),
      participant('M Umair Sayed', 'noreply@discuss.frappe.io'),
    ]
    expect(formatThreadParticipants(thread)).toBe('Jay1987, M Umair')
    expect(
      formatThreadParticipants([
        participant('A. Sarfaraz Shaikh', 'sarfaraz@frappe.io'),
        participant('Vibhav Katre', 'vibhav@frappe.io', true),
      ]),
    ).toBe('A. Sarfaraz, me')
    // A lone initial is still all there is to go by.
    expect(
      formatThreadParticipants([
        participant('M', 'noreply@discuss.frappe.io'),
        participant('Jay1987', 'noreply@discuss.frappe.io'),
      ]),
    ).toBe('M, Jay1987')
  })

  it('falls back to the address of a sender who goes by no name', () => {
    expect(formatThreadParticipants([participant('', 'noreply@frappe.io')])).toBe(
      'noreply@frappe.io',
    )
    expect(
      formatThreadParticipants([
        participant('  ', 'noreply@frappe.io'),
        participant('Vibhav Katre', 'vibhav@frappe.io', true),
      ]),
    ).toBe('noreply@frappe.io, me')
  })

  it('has nothing to say about a thread with no senders', () => {
    expect(formatThreadParticipants([])).toBe('')
  })
})
