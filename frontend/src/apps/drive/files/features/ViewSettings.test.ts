import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, type LocationQueryRaw } from 'vue-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  FILES_COLUMNS,
  readPresentationPreference,
  replacePresentation,
  resolvePresentation,
  writePresentationPreference,
  type FilesColumn,
  type FilesDateColumn,
} from './presentation'
import ViewSettings from './ViewSettings.vue'

// Tests resolve `frappe-ui` to a recorder stub. The panel needs the real
// popover, segmented control and select, so these reach past the alias.
vi.mock('frappe-ui', async () => ({
  Button: (await import('../../../../../../node_modules/frappe-ui/src/components/Button/Button.vue')).default,
  Popover: (await import('../../../../../../node_modules/frappe-ui/src/components/Popover/Popover.vue')).default,
  Select: (await import('../../../../../../node_modules/frappe-ui/src/components/Select/Select.vue')).default,
  TabButtons: (await import('../../../../../../node_modules/frappe-ui/src/components/TabButtons/TabButtons.vue')).default,
}))

beforeAll(() => {
  // jsdom lacks the pointer-capture and scrolling calls the select makes.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  unmount = undefined
  document.body.innerHTML = ''
  localStorage.clear()
})

/**
 * View settings wired the way the Files page wires it: the choice lives in the
 * URL and the saved preference, and the panel shows what they resolve to.
 */
async function mountPanel({
  query = {},
  arrangeable = true,
  columns = FILES_COLUMNS,
  dateColumn,
}: { query?: LocationQueryRaw; arrangeable?: boolean; columns?: readonly FilesColumn[]; dateColumn?: FilesDateColumn } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push({ path: '/', query })
  const saved = ref(0)
  const presentation = computed(() => {
    void saved.value
    return resolvePresentation(router.currentRoute.value.query)
  })
  const Harness = defineComponent(() => () =>
    h(ViewSettings, {
      presentation: presentation.value,
      arrangeable,
      columns,
      dateColumn,
      onChange: (change: Parameters<typeof replacePresentation>[2]) => replacePresentation(router, presentation.value, change),
      onToggleColumn: (column: FilesColumn, visible: boolean) => {
        const chosen = presentation.value
        writePresentationPreference({
          ...chosen,
          columns: visible ? [...chosen.columns, column] : chosen.columns.filter((item) => item !== column),
        })
        saved.value += 1
      },
    }),
  )
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(Harness)
  app.use(router)
  app.mount(root)
  unmount = () => app.unmount()
  await settle()
  return { router }
}

async function openPanel() {
  document.querySelector<HTMLElement>('button[aria-label="View settings"]')!.click()
  await settle()
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve))
  }
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="group"][aria-label="View settings"]')
}

function byRole(role: string, name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find(
    (element) => element.textContent?.trim() === name,
  )
  if (!found) throw new Error(`No ${role} named ${name}`)
  return found
}

function pill(name: string): HTMLButtonElement {
  const found = [...(panel()?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? [])].find(
    (button) => button.textContent?.trim() === name,
  )
  if (!found) throw new Error(`No column pill named ${name}`)
  return found
}

function labels(): string[] {
  return [...(panel()?.querySelectorAll('label') ?? [])].map((label) => label.textContent!.trim())
}

function pills(): string[] {
  return [...(panel()?.querySelectorAll('button[aria-pressed]') ?? [])].map((button) => button.textContent!.trim())
}

/** Picks an option from the select labelled `label`, with the keyboard. */
async function pick(label: string, option: string) {
  const field = [...panel()!.querySelectorAll('label')].find((element) => element.textContent?.trim() === label)!
  const trigger = document.getElementById(field.htmlFor)!
  trigger.focus()
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  byRole('option', option).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
}

describe('View settings panel', () => {
  it('switches to grid from the view toggle', async () => {
    const { router } = await mountPanel({ query: { view: 'list' } })
    await openPanel()
    expect(byRole('radio', 'List').getAttribute('aria-checked')).toBe('true')

    byRole('radio', 'Grid').click()
    await settle()

    expect(router.currentRoute.value.query.view).toBe('grid')
    expect(readPresentationPreference()?.view).toBe('grid')
    expect(byRole('radio', 'Grid').getAttribute('aria-checked')).toBe('true')
    expect(panel()).not.toBeNull()
  })

  it('changes the sort, and words the order for the new field', async () => {
    const { router } = await mountPanel({ query: { view: 'list', sort: 'title', dir: 'asc' } })
    await openPanel()

    await pick('Sort by', 'Modified')

    expect(router.currentRoute.value.query.sort).toBe('modified')
    expect(readPresentationPreference()?.sort).toBe('modified')
    expect(panel()).not.toBeNull()

    await pick('Order', 'Newest first')
    expect(router.currentRoute.value.query.dir).toBe('desc')
  })

  it('toggles a column pill and leaves the panel open', async () => {
    await mountPanel({ query: { view: 'list' } })
    await openPanel()
    expect(pill('Size').getAttribute('aria-pressed')).toBe('false')

    pill('Size').click()
    await settle()

    expect(readPresentationPreference()?.columns).toContain('size')
    expect(panel()).not.toBeNull()
    expect(pill('Size').getAttribute('aria-pressed')).toBe('true')

    pill('Size').click()
    await settle()
    expect(readPresentationPreference()?.columns).not.toContain('size')
  })

  it('still switches the view when the browser refuses to save it', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError')
    })
    try {
      const { router } = await mountPanel({ query: { view: 'list' } })
      await openPanel()

      byRole('radio', 'Grid').click()
      await settle()

      expect(router.currentRoute.value.query.view).toBe('grid')
      expect(byRole('radio', 'Grid').getAttribute('aria-checked')).toBe('true')
    } finally {
      setItem.mockRestore()
    }
  })

  it('offers only what applies to the place and the view', async () => {
    await mountPanel({ query: { view: 'list' }, arrangeable: false, columns: ['modified', 'kind', 'size'] })
    await openPanel()
    expect(labels()).toEqual([])
    expect(pills()).toEqual(['Modified', 'Type', 'Size'])

    // Recent's list heads its date column Opened, and the pill says the same.
    unmount?.()
    await mountPanel({ query: { view: 'list' }, arrangeable: false, columns: ['modified', 'kind', 'size'], dateColumn: 'opened' })
    await openPanel()
    expect(pills()).toEqual(['Opened', 'Type', 'Size'])

    unmount?.()
    await mountPanel({ query: { view: 'grid' } })
    await openPanel()
    expect(labels()).toEqual(['Sort by', 'Order'])
    expect(pills()).toEqual([])
  })
})
