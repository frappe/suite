import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { Mail } from '@/apps/mail/types'

import { useReplyReminder } from './useReplyReminder'

const asked = vi.hoisted(() => ({ data: null }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }))
const mutation = vi.hoisted(() => vi.fn())
vi.stubGlobal('__', (text: string) => text)
vi.mock('frappe-ui', () => ({ toast }))
vi.mock('@/api', () => ({
  api: { mail: { messages: {} } },
  client: { mutation },
  useQuery: () => asked,
}))

const SENT = 'sent'
const mail = (id: string, box: string, draft = 0) =>
  fromPartial<Mail>({ id, draft, mailboxes: [{ mailbox_id: box }] })

const offered = (thread: Mail[], remindAt: string | null = null) => {
  Object.assign(asked, reactive({ data: { remind_at: remindAt } }))
  const { remindable } = useReplyReminder(
    () => 'a',
    () => 't1',
    () => thread,
    () => SENT,
  )
  return remindable.value
}

describe('offering a reminder if nobody replies', () => {
  it('is offered while the last word is yours', () => {
    expect(offered([mail('theirs', 'inbox'), mail('mine', SENT)])).toBe(true)
  })

  it('is not offered once they have answered', () => {
    expect(offered([mail('mine', SENT), mail('theirs', 'inbox')])).toBe(false)
  })

  it('reads past a draft you have not sent', () => {
    expect(offered([mail('mine', SENT), mail('draft', 'drafts', 1)])).toBe(true)
    expect(offered([mail('theirs', 'inbox'), mail('draft', 'drafts', 1)])).toBe(false)
  })

  it('is not offered again while one is set', () => {
    expect(offered([mail('mine', SENT)], '2026-11-10T09:00:00Z')).toBe(false)
  })
})

// The strip stays until the reminder is read again, so saying it is gone waits for the server.
it('says a reminder is removed once the server has removed it', async () => {
  let land: (() => void) | undefined
  mutation.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      land = resolve
    }),
  )
  useReplyReminder(
    () => 'a',
    () => 't1',
    () => [],
    () => SENT,
  ).cancel()
  expect(toast.success).not.toHaveBeenCalled()

  land?.()
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Reminder removed', undefined))
})
