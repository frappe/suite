import { fromPartial } from '@total-typescript/shoehorn'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailListItem from '@/apps/mail/components/MailListItem.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { Thread } from '@/apps/mail/types'
import { translationPlugin } from '@/platform/translation'

// The real user store, over queries that load when the test says so.
const queries = vi.hoisted(() => new Map<unknown, { data: unknown }>())
vi.mock('@/api', async () => {
  const { reactive } = await import('vue')
  const ref = (name: string) => ({ name })
  return {
    api: {
      mail: {
        account: { get: ref('account') },
        unified: { folders: ref('unifiedFolders'), tabCounts: ref('unifiedTabCounts') },
        mailboxes: { list: ref('mailboxes') },
        addressBooks: { list: ref('addressBooks') },
        identities: { list: ref('identities') },
        screening: { list: ref('screening'), global: ref('globalScreening') },
        sieve: { list: ref('sieve') },
        tabs: { counts: ref('tabCounts') },
        messages: {},
      },
    },
    client: { mutation: vi.fn() },
    useQuery: (descriptor: { name: string }) => {
      const query = reactive<{ data: unknown; refetch: () => void }>({
        data: undefined,
        refetch: vi.fn(),
      })
      queries.set(descriptor.name, query)
      return query
    },
  }
})
vi.mock('@/apps/mail/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/platform/session', () => ({ useSession: () => ({ user: ref('me@example.com') }) }))

vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  const passthrough = () =>
    defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    })
  return {
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Checkbox')),
    Avatar: passthrough(),
    Badge: passthrough(),
    Popover: passthrough(),
    Tooltip: passthrough(),
  }
})
vi.mock('@/apps/mail/components/AttachmentCapsule.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/AttachmentViewer.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/MailDate.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/components/MailRowActions.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/composables/useScreener', () => ({
  useScreener: () => ({ waitingSenders: () => [] }),
}))
vi.mock('@/apps/mail/resources', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/mail/utils', () => ({
  downloadUrlAsFile: () => undefined,
  getFileIcon: () => undefined,
  getFormattedRecipients: () => '',
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useOwnEmails: () => ref(new Set(['me@example.com'])),
  useScreenSize: () => ({ isMobile: ref(false) }),
}))
vi.mock('@/apps/mail/utils/unifiedFolders', () => ({ threadLink: () => '/thread' }))

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

const sentMail = fromPartial<Thread>({
  thread_id: 't1',
  seen: 1,
  mailboxes: [],
  attachments: [],
  received_at: '2026-11-06T10:00:00Z',
  messages: [fromPartial({ from_name: 'Me', from_email: 'me@example.com', mailboxes: [], to: [] })],
  from_name: 'Me',
  from_email: 'me@example.com',
  recipients: [fromPartial({ type: 'To', display_name: 'Fox Mulder', email: 'fox@example.com' })],
})
const folders = [
  { id: 'sent-id', role: 'sent' },
  { id: 'drafts-id', role: 'drafts' },
]

// A row of one account's folder, as MailboxView renders it: no `outgoing` prop.
const mountRow = async (mailbox: string, { foldersLoaded = true } = {}) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  userStore()
  if (foldersLoaded) queries.get('mailboxes')!.data = folders
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const el = document.createElement('div')
  const app = createApp(MailListItem, { mail: sentMail, mailbox, isSelected: false })
  app.use(pinia).use(router).use(translationPlugin)
  app.provide('$user', reactive({ data: { show_reading_pane: true } }))
  app.mount(el)
  mounted.push(app)
  return () => el.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')
}
const loadFolders = async () => {
  queries.get('mailboxes')!.data = folders
  await nextTick()
}

describe('a row in Sent or Drafts names who the mail is going to', () => {
  it('in Sent', async () => {
    const label = await mountRow('sent-id')
    expect(label()).toBe('Select mail to Fox Mulder')
  })

  it('in Drafts', async () => {
    const label = await mountRow('drafts-id')
    expect(label()).toBe('Select mail to Fox Mulder')
  })

  // Opening Sent straight from a reload: the rows can be on screen before the folder list has said
  // which folder is Sent.
  it('when the folder list loads after the row', async () => {
    const label = await mountRow('sent-id', { foldersLoaded: false })
    expect(label()).toBe('Select mail from Me')
    await loadFolders()
    expect(label()).toBe('Select mail to Fox Mulder')
  })
})
