import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import { defaultVideoFit } from '../data/mediaPreferences'
import ParticipantTile from './ParticipantTile.vue'

vi.mock('frappe-ui', async (importOriginal) => {
  const original = await importOriginal<object>()
  const { defineComponent, h } = await import('vue')
  return {
    ...original,
    Dropdown: defineComponent({
      props: { open: Boolean },
      emits: ['update:open'],
      setup(props, { emit }) {
        return () =>
          h('div', [
            h('button', { onClick: () => emit('update:open', true) }, 'Open tile menu'),
            props.open ? h('div', { role: 'menu' }) : null,
          ])
      },
    }),
  }
})

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  defaultVideoFit.value = undefined
})

function mountTile(options: { screenShare?: boolean } = {}) {
  const videoEnabled = ref(true)
  const root = document.createElement('div')
  const app = createApp({
    setup: () => () =>
      h(ParticipantTile, {
        participant: { user_id: 'alice', user_name: 'Alice' },
        interactive: true,
        pinType: options.screenShare ? 'screenshare' : 'participant',
        isVideoEnabled: videoEnabled.value,
        showNetworkState: false,
        videoRef: () => {},
      }),
  })
  app.mount(root)
  cleanups.push(() => app.unmount())
  return { root, videoEnabled }
}

describe('Participant tile', () => {
  it('keeps the full presentation frame until the viewer explicitly chooses Fill', async () => {
    const presentation = mountTile({ screenShare: true }).root
    const camera = mountTile().root

    expect(presentation.querySelector('video.object-contain')).not.toBeNull()
    expect(camera.querySelector('video.object-cover')).not.toBeNull()

    defaultVideoFit.value = 'fill'
    await nextTick()
    expect(presentation.querySelector('video.object-cover')).not.toBeNull()
  })

  it('keeps the menu closed when a camera comes back after turning off with the menu open', async () => {
    const { root, videoEnabled } = mountTile()
    const trigger = root.querySelector('button')
    expect(trigger).not.toBeNull()
    trigger?.click()
    await nextTick()
    expect(root.querySelector('[role="menu"]')).not.toBeNull()

    videoEnabled.value = false
    await nextTick()
    expect(root.querySelector('[role="menu"]')).toBeNull()

    videoEnabled.value = true
    await nextTick()
    expect(root.querySelector('button')).not.toBeNull()
    expect(root.querySelector('[role="menu"]')).toBeNull()
  })
})
