import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'

import type { DocumentVersion } from '@/apps/drive'

import VersionList from './VersionList.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  return {
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
    Tooltip: define({
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})

vi.mock('@/apps/writer/composables/useUsers', () => ({
  fullName: (user: string) => ({ 'ana@example.com': 'Ana Silva' })[user] ?? user,
}))

const NOW = new Date(2026, 9, 15, 18, 0)

const named = version(3, 'Before review', new Date(2026, 9, 15, 14, 14))
const automatic = version(2, null, new Date(2026, 9, 15, 9, 5))
const lastWeek = version(1, null, new Date(2026, 9, 8, 11, 0))
const beforeRestoring = milestone(4, new Date(2026, 9, 15, 15, 0))
const VERSIONS = [beforeRestoring, named, automatic, lastWeek]

let mounted: App | null = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  mounted?.unmount()
  document.body.replaceChildren()
  vi.useRealTimers()
})

function version(seq: number, label: string | null, takenAt: Date) {
  const kind = label ? 'named' : 'auto'
  const shape = { seq, kind, label, actor: 'ana@example.com', creation: takenAt.toISOString() }
  return shape as unknown as DocumentVersion
}

function milestone(seq: number, takenAt: Date) {
  return { ...version(seq, 'Before restoring', takenAt), kind: 'milestone' }
}

interface ListOptions {
  canRestore?: boolean
  isRestoring?: boolean
  canSaveVersion?: boolean
  previewed?: DocumentVersion | null
  rename?: (version: DocumentVersion, label: string) => Promise<boolean>
}

function mountList({
  canRestore = true,
  isRestoring = false,
  canSaveVersion = true,
  previewed = null,
  rename,
}: ListOptions = {}) {
  const shown = ref(previewed)
  const restored: number[] = []
  const downloaded: number[] = []
  let saves = 0
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(() =>
    h(VersionList, {
      versions: VERSIONS,
      canRestore,
      isRestoring,
      canSaveVersion,
      rename,
      previewed: shown.value,
      'onUpdate:previewed': (next: DocumentVersion | null) => {
        shown.value = next
      },
      onRestore: ({ seq }: DocumentVersion) => restored.push(seq),
      onDownload: ({ seq }: DocumentVersion) => downloaded.push(seq),
      onSaveVersion: () => saves++,
    }),
  )
  app.mount(host)
  mounted = app
  return { host, shown, restored, downloaded, saves: () => saves }
}

function rowOf(host: Element, seq: number) {
  const rows = [...host.querySelectorAll('section > div > div')]
  return rows[VERSIONS.findIndex((each) => each.seq === seq)]
}

function rowButton(host: Element, seq: number) {
  return rowOf(host, seq).querySelector<HTMLButtonElement>('button[aria-pressed]')!
}

function currentButton(host: Element) {
  return [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Current version',
  )!
}

function menuOf(host: Element, seq: number) {
  return [...rowOf(host, seq).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
}

function menuItem(host: Element, seq: number, label: string) {
  return menuOf(host, seq).find((item) => item.textContent === label)!
}

function linesOf(host: Element, seq: number) {
  return [...rowButton(host, seq).querySelectorAll('p')].map((line) => line.textContent)
}

describe('the versions list', () => {
  it('lists versions under their day, newest first, below Current version', () => {
    const { host } = mountList()
    const headings = [...host.querySelectorAll('h3')].map((heading) => heading.textContent)

    expect(host.querySelector('button')!.textContent?.trim()).toBe('Current version')
    expect(headings).toEqual(['Today', expect.stringMatching(/^(Oct 8|8 Oct)$/)])
  })

  it('names a named version, then who took it and when', () => {
    const { host } = mountList()

    expect(linesOf(host, named.seq)).toEqual([
      'Before review',
      expect.stringMatching(/^Ana Silva · (2:14\s?pm|14:14)$/i),
    ])
  })

  it('gives an automatic version its time, then only who took it', () => {
    const { host } = mountList()

    expect(linesOf(host, automatic.seq)).toEqual([
      expect.stringMatching(/^(9:05\s?am|09:05)$/i),
      'Ana Silva',
    ])
  })

  it('views a version on its row, and goes back on Current version', async () => {
    const { host, shown } = mountList()

    rowButton(host, automatic.seq).click()
    await nextTick()
    const viewing = [shown.value?.seq, rowButton(host, automatic.seq).getAttribute('aria-pressed')]
    currentButton(host).click()
    await nextTick()

    expect([viewing, shown.value, currentButton(host).getAttribute('aria-pressed')]).toEqual([
      [automatic.seq, 'true'],
      null,
      'true',
    ])
  })
})

describe("a version's actions", () => {
  function restoreOf(host: Element, seq: number) {
    return rowOf(host, seq).querySelector<HTMLButtonElement>('[aria-label="Restore this version"]')
  }

  it('restores the version on its row', () => {
    const { host, restored } = mountList()

    restoreOf(host, automatic.seq)!.click()

    expect(restored).toEqual([automatic.seq])
  })

  it('downloads the version on its row from its menu', () => {
    const { host, downloaded } = mountList()

    menuItem(host, lastWeek.seq, 'Download').click()

    expect(downloaded).toEqual([lastWeek.seq])
  })

  it('offers no Restore to someone who can’t restore', () => {
    const { host } = mountList({ canRestore: false })

    expect(restoreOf(host, named.seq)).toBeNull()
  })

  it('holds Restore while a restore runs', () => {
    const { host } = mountList({ isRestoring: true })

    expect(restoreOf(host, named.seq)!.disabled).toBe(true)
  })

  it('saves a version from Current version', () => {
    const { host, saves } = mountList()

    host.querySelector<HTMLButtonElement>('[aria-label="Save version"]')!.click()

    expect(saves()).toBe(1)
  })

  it('offers no Save version to someone who can’t save', () => {
    const { host } = mountList({ canSaveVersion: false })

    expect(host.querySelector('[aria-label="Save version"]')).toBeNull()
  })

  it('shows the viewed row’s actions without a hover, and hides the others’ until one', () => {
    const { host } = mountList({ previewed: named })

    const isHidden = [named, automatic].map(
      (each) => restoreOf(host, each.seq)!.parentElement!.closest('.invisible') !== null,
    )

    expect(isHidden).toEqual([false, true])
  })
})

describe('renaming a version', () => {
  // A rename that records each name sent, and that Drive takes unless told to refuse
  function renamer(isRefusing = false) {
    const sent: [number, string][] = []
    async function rename(row: DocumentVersion, label: string) {
      sent.push([row.seq, label])
      if (isRefusing) {
        // As a browser moves focus off the box once saving disables it
        document.body.append(outsideButton)
        outsideButton.focus()
      }

      return !isRefusing
    }

    const outsideButton = document.createElement('button')
    return { sent, rename }
  }

  function nameBox() {
    return document.querySelector<HTMLInputElement>('input[aria-label="New version name"]')
  }

  async function pickRename(host: Element, seq: number) {
    menuItem(host, seq, 'Rename').click()
    await nextTick()
    await nextTick()
  }

  async function type(text: string) {
    nameBox()!.value = text
    nameBox()!.dispatchEvent(new Event('input'))
    await nextTick()
  }

  async function press(key: string) {
    nameBox()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve))
    await nextTick()
  }

  function labelsOf(host: Element, seq: number) {
    return menuOf(host, seq).map((item) => item.textContent)
  }

  it('offers Rename on automatic and named versions, not on one kept before a restore', () => {
    const { rename } = renamer()
    const { host } = mountList({ rename })

    expect(VERSIONS.map((each) => labelsOf(host, each.seq))).toEqual([
      ['Download'],
      ['Rename', 'Download'],
      ['Rename', 'Download'],
      ['Rename', 'Download'],
    ])
  })

  it('offers no Rename to someone who can’t rename', () => {
    const { host } = mountList()

    expect(labelsOf(host, named.seq)).toEqual(['Download'])
  })

  it('puts the cursor in a box on the row holding the current name', async () => {
    const { rename } = renamer()
    const { host } = mountList({ rename })

    await pickRename(host, named.seq)

    expect([nameBox()?.value, document.activeElement === nameBox()]).toEqual([
      'Before review',
      true,
    ])
  })

  it('sends the new name on Enter and shows the row again', async () => {
    const { sent, rename } = renamer()
    const { host } = mountList({ rename })

    await pickRename(host, automatic.seq)
    await type('  Before the review ')
    await press('Enter')

    expect([sent, nameBox()]).toEqual([[[automatic.seq, 'Before the review']], null])
  })

  it('sends nothing on Esc, on an empty name or on the same name', async () => {
    const { sent, rename } = renamer()
    const { host } = mountList({ rename })
    const isClosed: boolean[] = []

    for (const [text, key] of [
      ['Final', 'Escape'],
      ['   ', 'Enter'],
      ['Before review', 'Enter'],
    ]) {
      await pickRename(host, named.seq)
      await type(text)
      await press(key)
      isClosed.push(nameBox() === null)
    }

    expect([sent, isClosed]).toEqual([[], [true, true, true]])
  })

  it('keeps the box, the name and the cursor when the name isn’t taken', async () => {
    const { rename } = renamer(true)
    const { host } = mountList({ rename })

    await pickRename(host, named.seq)
    await type('Final')
    await press('Enter')

    expect([nameBox()?.value, document.activeElement === nameBox()]).toEqual(['Final', true])
  })

  it('takes back the focus the closing menu hands to its button, once', async () => {
    const { rename } = renamer()
    const { host } = mountList({ rename })
    const menuButton = rowOf(host, named.seq).querySelector<HTMLButtonElement>(
      '[aria-label="More version actions"]',
    )!

    await pickRename(host, named.seq)
    menuButton.focus()
    await nextTick()
    const isHandedBack = document.activeElement === nameBox()
    menuButton.focus()
    await nextTick()

    expect([isHandedBack, document.activeElement === menuButton]).toEqual([true, true])
  })

  it('leaves focus on the menu button when it comes back after the person has moved on', async () => {
    const { rename } = renamer()
    const { host } = mountList({ rename })
    const menuButton = rowOf(host, named.seq).querySelector<HTMLButtonElement>(
      '[aria-label="More version actions"]',
    )!

    await pickRename(host, named.seq)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    menuButton.focus()
    await nextTick()

    expect(document.activeElement === menuButton).toBe(true)
  })
})
