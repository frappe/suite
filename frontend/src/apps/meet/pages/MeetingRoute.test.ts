import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import MeetingRoute from './MeetingRoute.vue'

const request = vi.hoisted(() => vi.fn())

vi.mock('@/api', async () => {
  const { api } = await vi.importActual<typeof import('@/api')>('@/api')
  const { createApiClient } = await import('@/platform/server-state')
  const { useQuery } = createApiClient(
    { meet: async () => ({ policy: () => ({}) }) },
    { transport: { request } },
  )
  return { api, useQuery }
})
vi.mock('./Meeting.vue', () => ({
  default: defineComponent({
    props: ['resolvedCode', 'shareUrl'],
    setup: (props) => () => h('div', { 'data-meeting': props.resolvedCode }, props.shareUrl),
  }),
}))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

it('opens a call with the resolved code and leaves the original link in the address', async () => {
  request.mockResolvedValue({
    meeting: { code: 'abcd-efgh-ijkl', url: 'https://suite.example/meet/current-team-link' },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/meet/:meetingId', component: MeetingRoute }],
  })
  const root = document.createElement('div')
  const app = createApp({ render: () => h(RouterView) }).use(router)
  await router.push('/meet/previous-team-link')
  app.mount(root)
  cleanup = () => app.unmount()

  await vi.waitFor(() => {
    expect(root.querySelector('[data-meeting="abcd-efgh-ijkl"]')?.textContent).toBe(
      'https://suite.example/meet/current-team-link',
    )
  })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0]?.[1]).toEqual({ link: 'previous-team-link' })
  expect(router.currentRoute.value.fullPath).toBe('/meet/previous-team-link')
})
