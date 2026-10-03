import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { userStore } from '@/apps/calendar/stores/user'

// The store only needs `data` and `fetch` from a resource; nothing fires on its own.
vi.mock('frappe-ui', () => ({
  createResource: () => reactive({ data: undefined, fetch: vi.fn() }),
}))

const participant = (email: string, isDefault: 0 | 1 = 0) => ({
  name: `acc|${email}`,
  id: email,
  _name: email.split('@')[0],
  email,
  default: isDefault,
  account: 'acc',
})
const identity = (email: string) => ({ name: `acc|${email}`, id: email, email })

const storeWith = (participants?: object[], identities?: object[]) => {
  const store = userStore()
  store.participantIdentities.data = participants
  store.identities.data = identities
  return store
}

describe('organizerIdentity', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is undefined until both lists load', () => {
    expect(storeWith(undefined, undefined).organizerIdentity).toBeUndefined()
    expect(storeWith([participant('a@x.io')], undefined).organizerIdentity).toBeUndefined()
    expect(storeWith(undefined, [identity('a@x.io')]).organizerIdentity).toBeUndefined()
  })

  it('is undefined when no address is both a mail and a participant identity', () => {
    expect(storeWith([], []).organizerIdentity).toBeUndefined()
    expect(
      storeWith([participant('a@x.io')], [identity('b@x.io')]).organizerIdentity,
    ).toBeUndefined()
  })

  it('prefers the participant identity flagged default when it can send', () => {
    const store = storeWith(
      [participant('a@x.io'), participant('b@x.io', 1)],
      [identity('a@x.io'), identity('b@x.io')],
    )
    expect(store.organizerIdentity?.email).toBe('b@x.io')
  })

  it('skips a default that has no mail identity', () => {
    const store = storeWith([participant('a@x.io'), participant('b@x.io', 1)], [identity('a@x.io')])
    expect(store.organizerIdentity?.email).toBe('a@x.io')
  })

  it('falls back to the first common identity when none is flagged', () => {
    const store = storeWith(
      [participant('c@x.io'), participant('a@x.io'), participant('b@x.io')],
      [identity('b@x.io'), identity('a@x.io')],
    )
    expect(store.organizerIdentity?.email).toBe('a@x.io')
  })
})
