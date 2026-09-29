<!--
  One tab's body, loaded on the tab's first open. Until the chunk arrives, a
  loading state fills the same box, so nothing moves when the body shows.
-->
<template>
  <component :is="body" />
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import { LoadingIndicator } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'
import type { SettingsTab } from '@/shell/settings/settings'

const Loading = defineComponent({
  name: 'SettingsTabLoading',
  setup: () => () =>
    h(
      'div',
      {
        class: 'flex min-h-0 flex-1 items-center justify-center',
        role: 'status',
        'aria-label': __('Loading'),
      },
      h(LoadingIndicator, { class: 'size-5 text-ink-gray-5' }),
    ),
})

const Failed = defineComponent({
  name: 'SettingsTabFailed',
  setup: () => () =>
    h(
      'div',
      { class: 'flex min-h-0 flex-1 items-center justify-center px-6 text-center' },
      h('p', { class: 'text-p-base text-ink-gray-6' }, __('This tab could not load. Reload the page and try again.')),
    ),
})

// One async component per tab for the whole session: a second open reuses
// the loaded chunk and shows no loading state.
const bodies = new Map<string, Component>()

function bodyOf(tab: SettingsTab): Component {
  const loaded = bodies.get(tab.id)
  if (loaded) return loaded
  const body = defineAsyncComponent({
    loader: tab.body,
    loadingComponent: Loading,
    errorComponent: Failed,
    delay: 0,
  })
  bodies.set(tab.id, body)
  return body
}
</script>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ tab: SettingsTab }>()
const body = computed(() => bodyOf(props.tab))
</script>
