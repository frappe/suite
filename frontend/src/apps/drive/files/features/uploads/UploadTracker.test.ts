import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, reactive, type App } from 'vue'

import { setTweaks } from '@/platform/tweaks'

import type { UploadEntry, UploadQueue, UploadState } from './queue'
import UploadTracker from './UploadTracker.vue'

vi.mock('frappe-ui', () => ({
  Alert: defineComponent({
    props: ['title', 'description', 'primaryAction'],
    setup: (props) => () =>
      h('div', { 'data-slot': 'alert' }, [h('p', props.title), h('p', props.description)]),
  }),
  Button: defineComponent({
    props: ['label'],
    setup:
      (props, { attrs }) =>
      () =>
        h('button', attrs, props.label),
  }),
  Progress: defineComponent({ setup: () => () => h('div', { 'data-slot': 'progress' }) }),
}))

vi.mock('@/apps/drive', () => ({
  driveNodeRoute: ({ name }: { name: string }) => ({ path: `/d/${name}` }),
}))

const RouterLink = defineComponent({
  props: ['to'],
  setup:
    (props, { slots }) =>
    () =>
      h('a', { href: props.to.path }, slots.default?.()),
})

const MB = 1024 * 1024

function entry(state: UploadState, fields: Partial<UploadEntry> = {}): UploadEntry {
  return {
    id: `${state}-${Math.random()}`,
    title: `${state}.bin`,
    size: 10 * MB,
    parent: 'folder',
    replaces: null,
    state,
    sent: state === 'done' ? 10 * MB : 4 * MB,
    error: state === 'failed' ? 'It failed.' : null,
    retryable: true,
    note: null,
    node: state === 'done' ? 'n1' : null,
    offline: false,
    ...fields,
  }
}

/** The queue as the tracker reads it. */
function fakeQueue(rows: UploadEntry[], state: Partial<UploadQueue['state']> = {}) {
  const list = reactive(rows)
  const sent = list.reduce((sum, row) => sum + row.sent, 0)
  const total = list.reduce((sum, row) => sum + row.size, 0)
  return {
    entries: computed(() => list),
    state: reactive({
      halted: null,
      preparing: 0,
      folders: { created: 0, total: 0 },
      reading: null,
      seen: true,
      trackerOpen: true,
      trackerMounted: false,
      showDone: false,
      ...state,
    }),
    indicator: computed(() => ({
      fraction: total ? sent / total : 0,
      tone: 'running' as const,
      attention: false,
      bytes: { sent, total },
    })),
    markSeen: vi.fn(),
    setTrackerMounted: vi.fn(),
  } as unknown as UploadQueue
}

let app: App | null = null
function mount(queue: UploadQueue) {
  const root = document.createElement('div')
  app = createApp(UploadTracker, { queue })
  app.component('RouterLink', RouterLink)
  app.mount(root)
  return {
    heading: root.querySelector('h2')?.textContent?.trim(),
    summary: root.querySelector("[data-slot='upload-summary']")?.textContent?.trim() ?? null,
    root,
  }
}

const SUMMARY = ['t30-overall-progress', 't30-time-left', 't30-open-finished', 't30-messages']

afterEach(() => {
  app?.unmount()
  app = null
  setTweaks(SUMMARY, true)
})

describe('Upload tracker header', () => {
  it.each([
    {
      rows: [entry('uploading'), entry('held')],
      heading: 'Uploading 2 files',
      summary: '8 MB of 20 MB',
    },
    {
      rows: [entry('held')],
      state: { halted: 'Full' },
      heading: 'Upload paused',
      summary: '4 MB of 10 MB',
    },
    { rows: [entry('reconnecting')], heading: 'Waiting for connection', summary: '4 MB of 10 MB' },
    { rows: [entry('interrupted'), entry('done')], heading: '1 upload stopped', summary: null },
    {
      rows: [entry('failed'), entry('failed'), entry('done')],
      heading: '2 uploads failed',
      summary: null,
    },
    { rows: [entry('done')], heading: '1 file uploaded', summary: null },
    { rows: [entry('done'), entry('skipped')], heading: 'Uploads', summary: null },
    {
      rows: [],
      state: { reading: { found: 3 } },
      heading: 'Reading folder…',
      summary: '3 files found',
    },
    {
      rows: [],
      state: { preparing: 1, folders: { created: 1, total: 4 } },
      heading: 'Creating folders…',
      summary: '1 of 4',
    },
  ])('says $heading', ({ rows, state, heading, summary }) => {
    const shown = mount(fakeQueue(rows, state))
    expect([shown.heading, shown.summary]).toEqual([heading, summary])
  })

  it('keeps the old heading with t30-overall-progress off', () => {
    setTweaks(['t30-overall-progress'], false)
    const done = mount(fakeQueue([entry('done')]))
    expect([done.heading, done.summary]).toEqual(['Uploads', null])
    app!.unmount()
    const preparing = mount(fakeQueue([], { preparing: 1 }))
    expect(preparing.heading).toBe('Preparing upload')
    expect(preparing.root.textContent).toContain('Creating folders…')
  })
})

describe('Upload tracker rows', () => {
  it('links a finished upload to its file, and not with t30-open-finished off', () => {
    const linked = mount(fakeQueue([entry('done')]))
    expect(linked.root.querySelector('a')?.getAttribute('href')).toBe('/d/n1')
    app!.unmount()
    setTweaks(['t30-open-finished'], false)
    expect(mount(fakeQueue([entry('done')])).root.querySelector('a')).toBeNull()
  })

  it('a full Drive says what to do, without a second Retry all', () => {
    const rows = [entry('held'), entry('held')]
    const shown = mount(fakeQueue(rows, { halted: 'This upload exceeds the Drive root quota' }))
    const alert = shown.root.querySelector("[data-slot='alert']")!
    expect(alert.textContent).toBe('Storage is fullFree up space, then retry.')
    const header = shown.root.querySelector('header')!
    expect(
      [...header.querySelectorAll('button')].map((button) => button.textContent),
    ).not.toContain('Retry all')

    app!.unmount()
    setTweaks(['t30-messages'], false)
    const old = mount(fakeQueue(rows, { halted: 'This upload exceeds the Drive root quota' }))
    expect(old.root.querySelector("[data-slot='alert']")!.textContent).toContain('Drive root quota')
    expect(old.root.querySelector('header')!.textContent).toContain('Retry all')
  })
})
