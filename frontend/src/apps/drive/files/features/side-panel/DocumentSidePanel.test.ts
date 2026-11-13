import { fromPartial } from '@total-typescript/shoehorn'
import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'

import type {
  DocumentComments,
  DocumentPanel,
  DocumentSession,
  DocumentVersion,
  useCommentDrafts,
} from '@/apps/drive'
import type { VersionRestored } from '@/platform/collab'
import { requireTestElement } from '@/platform/testing/dom'
import { translationPlugin } from '@/platform/translation'

import { useDocumentComments } from './comments/useDocumentComments'
import DocumentSidePanel from './DocumentSidePanel.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  const emptyComponent = { render: () => null }
  return {
    Avatar: emptyComponent,
    // Shows the menu's items beside its button, as if it were open
    Dropdown: define({
      props: { options: fromPartial<() => { label: string; onClick: () => void }[]>(Array) },
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
          emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value)
        }

        return () => render('input', { ref: input, value: props.modelValue, onInput: write })
      },
    }),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  }
})

vi.mock('@/apps/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/drive')>()),
  formatDriveDateTime: String,
}))

interface NamingPanel {
  nameVersion(): Promise<void>
}

let mounted: App | null = null
const noDrafts = fromPartial<ReturnType<typeof useCommentDrafts>>({ drafts: ref([]) })

function noComments(drafts = noDrafts) {
  return fromPartial<DocumentComments>({
    threads: ref([]),
    readAt: ref(1),
    refresh: async () => {},
    actions: {},
    drafts,
  })
}

afterEach(() => {
  mounted?.unmount()
  document.body.replaceChildren()
})

// The Versions panel over a session that records the versions taken, after the edits are saved
async function openVersionsPanel(isRefusingVersions = false) {
  const steps: string[] = []
  const outsideButton = document.createElement('button')
  const session = fromPartial<DocumentSession>({
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
  })
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
      canShare: false,
      canRestoreVersion: false,
      canSaveVersion: false,
      isRestoringVersion: false,
      comments: noComments(),
      places: null,
      noun: 'document',
      saveFirst: async () => {
        steps.push('saved')
      },
    }),
  )
  app.use(translationPlugin).mount(host)
  mounted = app
  await panel.value?.nameVersion()
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
    await view(fromPartial<DocumentVersion>({ seq: 1, kind: 'auto', label: null }))

    expect([nameBox(), host.textContent?.includes('Current version')]).toEqual([null, true])
  })

  it('keeps the box and its name when another version is viewed', async () => {
    const { view } = await openVersionsPanel()

    await type('Before the review')
    await view(fromPartial<DocumentVersion>({ seq: 1, kind: 'auto', label: null }))

    expect(nameBox()?.value).toBe('Before the review')
  })

  it('leaves the shown version and opens Versions to name one, from another panel', async () => {
    const panel = ref<NamingPanel | null>(null)
    const shownPanel = ref<DocumentPanel | null>('comments')
    const viewed = ref<DocumentVersion | null>(
      fromPartial<DocumentVersion>({ seq: 1, kind: 'auto', label: null }),
    )
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(() =>
      h(DocumentSidePanel, {
        ref: panel,
        panel: shownPanel.value,
        'onUpdate:panel': (next: DocumentPanel | null) => (shownPanel.value = next),
        previewedVersion: viewed.value,
        'onUpdate:previewedVersion': (next: DocumentVersion | null) => (viewed.value = next),
        session: fromPartial<DocumentSession>({
          comments: { list: async () => [] },
          versions: { list: async () => ({ rows: [], next_cursor: null }) },
        }),
        canComment: true,
        canEditDocument: false,
        canShare: false,
        canRestoreVersion: false,
        canSaveVersion: true,
        isRestoringVersion: false,
        comments: noComments(),
        places: null,
        noun: 'document',
        saveFirst: async () => {},
      }),
    )
    app.use(translationPlugin).mount(host)
    mounted = app

    await panel.value?.nameVersion()

    expect([shownPanel.value, viewed.value, document.activeElement === nameBox()]).toEqual([
      'versions',
      null,
      true,
    ])
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

describe('Escape over a shown version', () => {
  // A panel showing `version`, counting the times it asks to go back
  function panelShowing(version: DocumentVersion | null) {
    const backs: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(() =>
      h(DocumentSidePanel, {
        panel: 'versions',
        previewedVersion: version,
        onBack: () => backs.push('back'),
        session: fromPartial<DocumentSession>({
          versions: { list: async () => ({ rows: [], next_cursor: null }) },
        }),
        canComment: true,
        canEditDocument: false,
        canShare: false,
        canRestoreVersion: false,
        canSaveVersion: false,
        isRestoringVersion: false,
        comments: noComments(),
        places: null,
        noun: 'document',
        saveFirst: async () => {},
      }),
    )
    app.use(translationPlugin).mount(host)
    mounted = app
    return backs
  }

  function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }

  const shown = fromPartial<DocumentVersion>({ seq: 1, kind: 'auto', label: null })

  it('goes back once a version is shown, and not with none shown', () => {
    const fromShown = panelShowing(shown)
    pressEscape()
    mounted?.unmount()
    const fromNone = panelShowing(null)
    pressEscape()

    expect([fromShown, fromNone]).toEqual([['back'], []])
  })

  it('leaves the key to a dialog or menu open over the version', () => {
    const backs = panelShowing(shown)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    pressEscape()

    expect(backs).toEqual([])
  })
})

describe('a version restored by someone else', () => {
  it('tells the person in the app’s word, and lists the versions again', async () => {
    const reads: string[] = []
    const panel = ref<{ tellRestoredByOther(restored: VersionRestored): Promise<void> } | null>(
      null,
    )
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(() =>
      h(DocumentSidePanel, {
        ref: panel,
        panel: 'versions',
        previewedVersion: null,
        session: fromPartial<DocumentSession>({
          versions: {
            list: async () => {
              reads.push('versions')
              return { rows: [], next_cursor: null }
            },
          },
        }),
        canComment: true,
        canEditDocument: false,
        canShare: false,
        canRestoreVersion: false,
        canSaveVersion: false,
        isRestoringVersion: false,
        comments: noComments(),
        places: null,
        noun: 'presentation',
        saveFirst: async () => {},
      }),
    )
    app.use(translationPlugin).mount(host)
    mounted = app
    await settled()
    reads.length = 0

    await panel.value?.tellRestoredByOther({ by: null, version: null })
    await settled()

    expect([vi.mocked(toast.info).mock.lastCall, reads]).toEqual([
      ['Someone restored an earlier version of this presentation.'],
      ['versions'],
    ])
  })
})

describe('renaming a version in the Versions panel', () => {
  const automatic = fromPartial<DocumentVersion>({
    seq: 2,
    kind: 'auto',
    pinned: 0,
    creation: null,
  })

  // The panel viewing an automatic version, recording each version it is told to show
  async function openViewingPanel(canSaveVersion: boolean) {
    const shown: (string | null | undefined)[] = []
    const session = fromPartial<DocumentSession>({
      comments: {},
      versions: {
        list: async () => ({ rows: [automatic], next_cursor: null }),
        update: async () => {},
      },
    })
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
        canShare: false,
        canRestoreVersion: false,
        canSaveVersion,
        isRestoringVersion: false,
        comments: noComments(),
        places: null,
        noun: 'document',
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
  const session = fromPartial<DocumentSession>({
    nodeId: 'doc-1',
    comments: {},
    versions: { list: () => new Promise(() => {}) },
  })
  const drafts = fromPartial<ReturnType<typeof useCommentDrafts>>({
    drafts: ref([]),
    start: (anchor: string) => started.push(anchor),
  })
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
      canShare: false,
      canRestoreVersion: false,
      canSaveVersion: false,
      isRestoringVersion: false,
      comments: noComments(drafts),
      places: null,
      noun: 'document',
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

// The real panel over a document's real comment threads, with the reads of them counted
function panelOverThreads(
  isShown: (panel: DocumentPanel | null) => boolean,
  first: DocumentPanel | null,
) {
  const reads: number[] = []
  const session = fromPartial<DocumentSession>({
    nodeId: 'node-1',
    comments: {
      list: async () => {
        reads.push(1)
        return { threads: [] }
      },
    },
    versions: { list: async () => ({ rows: [], next_cursor: null }) },
  })
  const panel = ref<DocumentPanel | null>(first)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      const comments = useDocumentComments(session, { isShown: () => isShown(panel.value) })
      return () =>
        h(DocumentSidePanel, {
          panel: panel.value,
          previewedVersion: null,
          session,
          canComment: true,
          canEditDocument: false,
          canShare: false,
          canRestoreVersion: false,
          canSaveVersion: false,
          isRestoringVersion: false,
          comments,
          places: null,
          noun: 'document',
          saveFirst: async () => {},
        })
    },
  })
  app.use(translationPlugin).mount(host)
  mounted = app
  return { panel, reads }
}

describe('reading the threads the Comments panel shows', () => {
  it('reads them once when Comments opens, where they are read only while it is open', async () => {
    const { panel, reads } = panelOverThreads((open) => open === 'comments', null)
    await settled()

    panel.value = 'comments'
    await settled()

    expect(reads).toHaveLength(1)
  })

  it('reads them once when the panel starts on Comments, where they are always read', async () => {
    const { reads } = panelOverThreads(() => true, 'comments')
    await settled()

    expect(reads).toHaveLength(1)
  })
})
