import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'

import { accountFragments, withAccountFragments } from './fragmentHistory'

const { toAddress, fromAddress } = accountFragments(['mail'])

describe('the address an account-scoped page is shown at', () => {
  it('keeps the page in the fragment', () => {
    expect(toAddress('/mail/a/0/inbox')).toBe('/mail/a/0/#inbox')
    expect(toAddress('/mail/a/12/sent/Tabc123')).toBe('/mail/a/12/#sent/Tabc123')
  })

  it('writes a space as a plus, and a plus escaped', () => {
    expect(toAddress('/mail/a/0/mailbox/Custom%20Folder')).toBe('/mail/a/0/#mailbox/Custom+Folder')
    expect(toAddress('/mail/a/0/mailbox/C++')).toBe('/mail/a/0/#mailbox/C%2B%2B')
  })

  it('keeps the query after the page', () => {
    expect(toAddress('/mail/a/0/search?from=a%40b.c')).toBe('/mail/a/0/#search?from=a%40b.c')
  })

  it('leaves every other location alone', () => {
    for (const location of ['/mail/a/0', '/mail/dashboard/domains', '/calendar/a/0/week', '/mail/login?x=1'])
      expect(toAddress(location)).toBe(location)
  })
})

describe('the location an address is routed as', () => {
  it('is the plain path', () => {
    expect(fromAddress('/mail/a/0/#inbox')).toBe('/mail/a/0/inbox')
    expect(fromAddress('/mail/a/0#inbox/Tabc123')).toBe('/mail/a/0/inbox/Tabc123')
    expect(fromAddress('/mail/a/0/#mailbox/Custom+Folder')).toBe('/mail/a/0/mailbox/Custom%20Folder')
    expect(fromAddress('/mail/a/0/#mailbox/C%2B%2B')).toBe('/mail/a/0/mailbox/C%2B%2B')
  })

  it('carries a query from either side of the fragment', () => {
    expect(fromAddress('/mail/a/0/#search?from=a%40b.c')).toBe('/mail/a/0/search?from=a%40b.c')
    expect(fromAddress('/mail/a/0/?compose=1#inbox')).toBe('/mail/a/0/inbox?compose=1')
    expect(fromAddress('/mail/a/0/?compose=1#inbox?to=x')).toBe('/mail/a/0/inbox?compose=1&to=x')
  })

  it('reads the plain path form as it is', () => {
    expect(fromAddress('/mail/a/0/inbox/Tabc123')).toBe('/mail/a/0/inbox/Tabc123')
    expect(fromAddress('/mail/a/0/')).toBe('/mail/a/0/')
  })

  it('leaves the fragment of another app alone', () => {
    expect(fromAddress('/writer/doc/1#tab-2')).toBe('/writer/doc/1#tab-2')
  })
})

describe('a router over the fragment history', () => {
  const Stub = { render: () => null }
  const setup = () => {
    const browser = createMemoryHistory()
    const router = createRouter({
      history: withAccountFragments(browser, ['mail']),
      routes: [
        { path: '/mail/a/:account/mailbox/:mailbox/:threadID?', name: 'mailbox', component: Stub },
        { path: '/mail/dashboard', name: 'dashboard', component: Stub },
      ],
    })
    return { browser, router }
  }

  it('matches paths while the browser sees fragments', async () => {
    const { browser, router } = setup()
    await router.push({ name: 'mailbox', params: { account: '0', mailbox: 'Custom Folder' } })

    expect(browser.location).toBe('/mail/a/0/#mailbox/Custom+Folder')
    expect(router.currentRoute.value.params.mailbox).toBe('Custom Folder')
    expect(router.currentRoute.value.hash).toBe('')
  })

  it('links to the address, not the path', () => {
    const { router } = setup()
    const link = router.resolve({ name: 'mailbox', params: { account: '1', mailbox: 'Bills', threadID: 'T1' } })
    expect(link.href).toBe('/mail/a/1/#mailbox/Bills/T1')
  })

  it('opens an address typed into the browser', async () => {
    const { browser, router } = setup()
    browser.replace('/mail/a/2/#mailbox/Custom+Folder/T9?filter=unread')
    await router.push(router.options.history.location)

    const route = router.currentRoute.value
    expect([route.name, route.params, route.query]).toEqual([
      'mailbox',
      { account: '2', mailbox: 'Custom Folder', threadID: 'T9' },
      { filter: 'unread' },
    ])
  })

  it('follows the browser back to an earlier page', async () => {
    const { router } = setup()
    await router.push('/mail/a/0/mailbox/One')
    await router.push('/mail/a/0/mailbox/Two')
    router.back()
    await new Promise((resolve) => setTimeout(resolve))

    expect(router.currentRoute.value.params.mailbox).toBe('One')
  })
})

describe('in the browser', () => {
  const Stub = { render: () => null }
  const open = async (address: string) => {
    window.history.replaceState(null, '', address)
    const router = createRouter({
      history: withAccountFragments(createWebHistory('/'), ['mail']),
      routes: [{ path: '/mail/a/:account/:mailbox/:threadID?', name: 'mailbox', component: Stub }],
    })
    await router.push(router.options.history.location)
    return router
  }
  const address = () => window.location.pathname + window.location.search + window.location.hash
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('opens the page a fragment names', async () => {
    const router = await open('/mail/a/1/#sent/T1?filter=unread')
    const { params, query } = router.currentRoute.value
    expect([params, query]).toEqual([{ account: '1', mailbox: 'sent', threadID: 'T1' }, { filter: 'unread' }])
  })

  it('rewrites the plain path it was opened at', async () => {
    await open('/mail/a/0/inbox/T1')
    expect(address()).toBe('/mail/a/0/#inbox/T1')
  })

  it('writes each page it goes to as a fragment, and reads them back', async () => {
    const router = await open('/mail/a/0/#inbox')
    await router.push({ name: 'mailbox', params: { account: '0', mailbox: 'drafts' } })
    expect(address()).toBe('/mail/a/0/#drafts')

    window.history.back()
    await settled()
    expect(router.currentRoute.value.params.mailbox).toBe('inbox')
  })

  it('follows a fragment edited in the address bar', async () => {
    const router = await open('/mail/a/0/#inbox')
    window.location.hash = '#trash'
    await settled()
    expect(router.currentRoute.value.params.mailbox).toBe('trash')
  })
})
