/* eslint-disable vue/one-component-per-file -- Fixtures cover desktop and mobile menu events. */
import type { DropdownItemSlotProps } from 'frappe-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import { useScreenSize } from '@/composables/useScreenSize'
import { createApiClient, installApiErrorHandler } from '@/platform/server-state'
import { createTransport, type MutationRef } from '@/platform/transport'

import { ContextMenu, Dropdown } from './index'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/components/Dropdown')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/ContextMenu')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/BottomSheet')),
  toast: { error: vi.fn() },
  dialog: {},
  FrappeUIProvider: {},
}))
const command: MutationRef<Record<never, never>, string> = {
  owner: 'test',
  id: 'save',
  kind: 'mutation',
  method: 'POST',
  path: '/save',
}
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
const report = vi.fn()
let engine: ReturnType<typeof createApiClient>
let unmount: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  engine = createApiClient(
    { test: async () => ({ policy: () => ({ effects: 'none' }) }) },
    { transport: createTransport({ fetch: fetcher, maxRetries: 0 }), persistence: false, feedback },
  )
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  engine.dispose()
  useScreenSize().isMobile.value = false
})
function refuse() {
  fetcher.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ errors: [{ type: 'Conflict', message: 'That title is taken' }] }),
        { status: 409 },
      ),
  )
}
describe('Menu actions', () => {
  it('owns the mobile sheet promise and reports one refusal without running success UI', async () => {
    useScreenSize().isMobile.value = true
    refuse()
    const success = vi.fn()
    const mutation = engine.useMutation(command)
    const app = createApp({
      render: () =>
        h(
          AdaptiveDropdown,
          {
            options: [
              {
                label: 'Save',
                onClick: async () => {
                  await mutation.run({})
                  success()
                },
              },
            ],
          },
          { default: () => h('button', 'Actions') },
        ),
    })
    app.config.errorHandler = report
    installApiErrorHandler(app)
    const root = document.createElement('div')
    document.body.append(root)
    app.mount(root)
    unmount = () => {
      app.unmount()
      root.remove()
    }
    root.querySelector('button')!.click()
    const save = await vi.waitFor(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ].find((b) => b.textContent?.trim() === 'Save')
      expect(button).toBeDefined()
      return button!
    })
    save.click()
    await vi.waitFor(() => expect(feedback).toHaveBeenCalledOnce())
    expect(success).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
    expect(mutation.isPending).toBe(false)
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  })
  it.each([Dropdown, ContextMenu])(
    'owns menu action failures, closes on selection, and allows a successful retry ($name)',
    async (Menu) => {
      refuse()
      const mutation = engine.useMutation(command)
      const success = vi.fn()
      const switchAction = vi.fn(async (_value: boolean) => {
        await mutation.run({})
      })
      const open = ref(false)
      const app = createApp({
        render: () =>
          h(
            Menu,
            {
              open: open.value,
              'onUpdate:open': (value: boolean) => {
                open.value = value
              },
              options: [
                {
                  group: 'Actions',
                  options: [
                    {
                      label: 'Save',
                      onClick: async () => {
                        await mutation.run({})
                        success()
                      },
                    },
                    { label: 'Enabled', switch: true, switchValue: false, onClick: switchAction },
                    {
                      label: 'More',
                      submenu: [{ label: 'Nested save', onClick: () => mutation.run({}) }],
                    },
                  ],
                },
              ],
            },
            {
              trigger: () => h('button', { 'data-custom-trigger': '' }, 'Actions'),
              'item-label': ({ item }: DropdownItemSlotProps) =>
                h('span', { 'data-custom-label': '' }, item.label),
            },
          ),
      })
      app.config.errorHandler = report
      installApiErrorHandler(app)
      const root = document.createElement('div')
      document.body.append(root)
      app.mount(root)
      unmount = () => {
        app.unmount()
        root.remove()
      }
      const showMenu = async () => {
        const trigger = root.querySelector<HTMLButtonElement>('[data-custom-trigger]')!
        if (Menu === ContextMenu)
          trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        else trigger.click()
        await nextTick()
        return vi.waitFor(() => {
          const item = document.querySelector<HTMLElement>('[role="menuitem"]')
          expect(item?.querySelector('[data-custom-label]')?.textContent).toBe('Save')
          expect(open.value).toBe(true)
          return item!
        })
      }
      const save = await showMenu()
      save.click()
      await vi.waitFor(() => expect(feedback).toHaveBeenCalledOnce())
      expect(open.value).toBe(false)
      expect(success).not.toHaveBeenCalled()
      expect(report).not.toHaveBeenCalled()
      expect(mutation.isPending).toBe(false)

      fetcher.mockImplementation(async () => new Response(JSON.stringify({ data: 'saved' })))
      const retry = await showMenu()
      retry.click()
      await vi.waitFor(() => expect(success).toHaveBeenCalledOnce())
      expect(open.value).toBe(false)
      expect(feedback).toHaveBeenCalledOnce()
      expect(report).not.toHaveBeenCalled()
      const broken = new TypeError('Broken menu action')
      success.mockImplementationOnce(() => {
        throw broken
      })
      const again = await showMenu()
      again.click()
      await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
      expect(report.mock.calls[0]?.[0]).toBe(broken)

      refuse()
      await showMenu()
      document.querySelector<HTMLButtonElement>('[role="switch"]')!.click()
      await vi.waitFor(() => expect(feedback).toHaveBeenCalledTimes(2))
      expect(switchAction).toHaveBeenCalledWith(true)
      expect(open.value).toBe(true)
      const more = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === 'More',
      )!
      more.focus()
      more.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      const nested = await vi.waitFor(() => {
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
          (item) => item.textContent?.trim() === 'Nested save',
        )
        expect(item).toBeDefined()
        return item!
      })
      nested.click()
      await vi.waitFor(() => expect(feedback).toHaveBeenCalledTimes(3))
      expect(open.value).toBe(false)
      expect(report).toHaveBeenCalledOnce()
    },
  )
})
