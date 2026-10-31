import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'

import type { DocumentPanel, DocumentSession, DocumentVersion } from '@/apps/drive'
import { translationPlugin } from '@/platform/translation'

import DocumentSidePanel from './DocumentSidePanel.vue'
import type { useCommentDrafts } from './useCommentDrafts'

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  const emptyComponent = { render: () => null }
  return {
    Avatar: emptyComponent,
    // Shows the menu's items beside its button, as if it were open
    Dropdown: define({
      props: { options: Array as () => { label: string; onClick: () => void }[] },
      setup:
        (props, { slots }) =>
        () =>
          render('div', [
            slots.default?.(),
            props.options?.map((option) =>
              render('button', { role: 'menuitem', onClick: option.onClick }, option.label),
            ),
          ]),
    }),
    Textarea: emptyComponent,
    Tooltip: emptyComponent,
    Button: define({
      props: { label: String },
      emits: ['click'],
      setup:
        (props, { emit }) =>
        () =>
          render('button', { onClick: () => emit('click') }, props.label),
    }),
    TextInput: define({
      props: { modelValue: String },
      emits: ['update:modelValue'],
      setup(props, { emit, expose }) {
        const input = state<HTMLInputElement | null>(null)
        expose({ focus: () => input.value?.focus() })
        function write(event: Event) {
          emit('update:modelValue', (event.target as HTMLInputElement).value)
        }

        return () => render('input', { ref: input, value: props.modelValue, onInput: write })
      },
    }),
    toast: { success: vi.fn(), error: vi.fn() },
  }
})

vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, ref: state } = await import('vue')
  return {
    DriveCommentAuthor: define({ setup: () => () => null }),
    formatDriveDateTime: String,
    GUEST_NAME_LIMIT: 140,
    useDriveGuestName: () => ({
      shown: state(false),
      text: state(''),
      atLimit: state(false),
      maxLength: 140,
      take: () => '',
    }),
  }
})

interface NamingPanel {
  startNamingVersion(): Promise<void>
}

let mounted: App | null = null
const noDrafts = { drafts: ref([]) } as unknown as ReturnType<typeof useCommentDrafts>

afterEach(() => {
  mounted?.unmount()
  document.body.replaceChildren()
})

// The Versions panel over a session that records the versions taken, after the edits are saved
async function openVersionsPanel(isRefusingVersions = false) {
  const steps: string[] = []
  const outsideButton = document.createElement('button')
  const session = {
    comments: {},
    versions: {
      list: async () => ({ rows: [], next_cursor: null }),
      create: async (kind: string, label: string) => {
        if (isRefusingVersions) {
          // As a browser moves focus off the box once saving disables it
          document.body.append(outsideButton)
          outsideButton.focus()
          throw new Error('offline')
        }

        steps.push(`took ${kind} "${label}"`)
      },
    },
  } as unknown as DocumentSession
  const panel = ref<NamingPanel | null>(null)
  const viewed = ref<DocumentVersion | null>(null)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(() =>
    h(DocumentSidePanel, {
      ref: panel,
      panel: 'versions',
      previewedVersion: viewed.value,
      session,
      canComment: true,
      canEditDocument: false,
      canRestoreVersion: false,
      canSaveVersion: false,
      isRestoringVersion: false,
      threads: [],
      threadsReadAt: 1,
      places: null,
      refreshThreads: async () => {},
      drafts: noDrafts,
      saveFirst: async () => {
        steps.push('saved')
      },
    }),
  )
  app.use(translationPlugin).mount(host)
  mounted = app
  await panel.value?.startNamingVersion()
  // As clicking another version's row in the list does
  async function view(version: DocumentVersion) {
    viewed.value = version
    await nextTick()
  }

  return { steps, host, view }
}

function nameBox() {
  return document.querySelector<HTMLInputElement>('input[aria-label="Version name"]')
}

async function press(key: string) {
  nameBox()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  await nextTick()
}

async function type(text: string) {
  const box = nameBox()
  if (!box) {
    throw new Error('no name box')
  }

  box.value = text
  box.dispatchEvent(new Event('input'))
  await nextTick()
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve))
  await nextTick()
}

describe('naming a version in the Versions panel', () => {
  it('opens a name box at the top with the cursor in it and the keys to use', async () => {
    const { host } = await openVersionsPanel()

    expect([document.activeElement === nameBox(), host.textContent]).toEqual([
      true,
      expect.stringContaining('Enter to save · Esc to cancel'),
    ])
  })

  it('saves the edits, then takes a version under the typed name, on Enter', async () => {
    const { steps } = await openVersionsPanel()

    await type('  Before the review ')
    await press('Enter')
    await settled()

    expect([steps, nameBox()]).toEqual([['saved', 'took named "Before the review"'], null])
  })

  it('takes nothing and closes the box on Esc', async () => {
    const { steps } = await openVersionsPanel()

    await type('Before the review')
    await press('Escape')
    await settled()

    expect([steps, nameBox()]).toEqual([[], null])
  })

  it('takes nothing and closes the box on Enter with an empty name', async () => {
    const { steps } = await openVersionsPanel()

    await type('   ')
    await press('Enter')
    await settled()

    expect([steps, nameBox()]).toEqual([[], null])
  })

  it('shows the name box in place of Current version, which comes back once the box closes', async () => {
    const { host } = await openVersionsPanel()
    const isCurrentShownWhileNaming = host.textContent?.includes('Current version')

    await press('Escape')
    await settled()

    expect([isCurrentShownWhileNaming, host.textContent?.includes('Current version')]).toEqual([
      false,
      true,
    ])
  })

  it('puts Current version back when another version is viewed with no name typed', async () => {
    const { host, view } = await openVersionsPanel()

    await type('   ')
    await view({ seq: 1, kind: 'auto', label: null } as unknown as DocumentVersion)

    expect([nameBox(), host.textContent?.includes('Current version')]).toEqual([null, true])
  })

  it('keeps the box and its name when another version is viewed', async () => {
    const { view } = await openVersionsPanel()

    await type('Before the review')
    await view({ seq: 1, kind: 'auto', label: null } as unknown as DocumentVersion)

    expect(nameBox()?.value).toBe('Before the review')
  })

  it('keeps the box, the name and the cursor when the version fails to save', async () => {
    const { steps } = await openVersionsPanel(true)

    await type('Before the review')
    await press('Enter')
    await settled()

    expect([steps, nameBox()?.value, document.activeElement === nameBox()]).toEqual([
      ['saved'],
      'Before the review',
      true,
    ])
  })
})

describe('renaming a version in the Versions panel', () => {
  const automatic = {
    seq: 2,
    kind: 'auto',
    label: null,
    pinned: 0,
    actor: null,
    creation: null,
  } as unknown as DocumentVersion

  // The panel viewing an automatic version, recording each version it is told to show
  async function openViewingPanel(canSaveVersion: boolean) {
    const shown: (string | null | undefined)[] = []
    const session = {
      comments: {},
      versions: {
        list: async () => ({ rows: [automatic], next_cursor: null }),
        update: async () => {},
      },
    } as unknown as DocumentSession
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(() =>
      h(DocumentSidePanel, {
        panel: 'versions',
        previewedVersion: automatic,
        'onUpdate:previewedVersion': (version: DocumentVersion | null) =>
          shown.push(version?.label),
        session,
        canComment: true,
        canEditDocument: false,
        canRestoreVersion: false,
        canSaveVersion,
        isRestoringVersion: false,
        threads: [],
        threadsReadAt: 1,
        places: null,
        refreshThreads: async () => {},
        drafts: noDrafts,
        saveFirst: async () => {},
      }),
    )
    app.use(translationPlugin).mount(host)
    mounted = app
    await settled()
    return { host, shown }
  }

  function renameItem(host: Element) {
    return [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Rename',
    )
  }

  it('gives the version being viewed its new name', async () => {
    const { host, shown } = await openViewingPanel(true)

    renameItem(host)!.click()
    await nextTick()
    const box = document.querySelector<HTMLInputElement>('input[aria-label="New version name"]')!
    box.value = 'Before the review'
    box.dispatchEvent(new Event('input'))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settled()

    expect(shown).toEqual(['Before the review'])
  })

  it('offers no Rename to someone who can’t save versions', async () => {
    const { host } = await openViewingPanel(false)

    expect(renameItem(host)).toBeUndefined()
  })
})

// The side panel, showing `kind`, over a session whose versions never finish loading
function panelWhileVersionsLoad(kind: DocumentPanel) {
  const started: string[] = []
  const shown = ref<DocumentPanel | null>(kind)
  const panel = ref<{ startDocumentComment(): Promise<void>; reloadVersions(): void } | null>(null)
  const session = {
    nodeId: 'doc-1',
    comments: {},
    versions: { list: () => new Promise(() => {}) },
  } as unknown as DocumentSession
  const drafts = {
    drafts: ref([]),
    start: (anchor: string) => started.push(anchor),
  } as unknown as ReturnType<typeof useCommentDrafts>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(() =>
    h(DocumentSidePanel, {
      ref: panel,
      panel: shown.value,
      'onUpdate:panel': (opened: DocumentPanel | null) => {
        shown.value = opened
      },
      previewedVersion: null,
      session,
      canComment: true,
      canEditDocument: false,
      canRestoreVersion: false,
      canSaveVersion: false,
      isRestoringVersion: false,
      threads: [],
      threadsReadAt: 1,
      places: null,
      refreshThreads: async () => {},
      drafts,
      saveFirst: async () => {},
    }),
  )
  app.use(translationPlugin).mount(host)
  mounted = app
  return { panel, host, started }
}

describe('the Comments panel while versions load', () => {
  it('starts a whole-document comment from the Versions panel before its versions arrive', async () => {
    const { panel, started } = panelWhileVersionsLoad('versions')
    await nextTick()

    await panel.value!.startDocumentComment()

    expect(started).toHaveLength(1)
  })

  it('keeps the comments shown while versions reload behind them', async () => {
    const { panel, host } = panelWhileVersionsLoad('comments')
    await nextTick()

    panel.value!.reloadVersions()
    await nextTick()

    expect([
      host.textContent?.includes('Loading…'),
      host.textContent?.includes('Add a comment'),
    ]).toEqual([false, true])
  })
})
