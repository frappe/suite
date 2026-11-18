<!--
  One tab's body, loaded on the tab's first open. Until the chunk arrives, the
  tab's header and the settings loading state show, in the place the loaded
  tab puts them, so nothing jumps when the body shows. It provides the tab's
  label, which the body's `SettingsPage` shows as its title.
-->
<template>
  <component :is="body" />
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'

import { SettingsPage } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'
import type { SettingsTab } from '@/shell/settings/settings'

function placeholder(tab: SettingsTab, failed: boolean): Component {
  return defineComponent({
    name: failed ? 'SettingsTabFailed' : 'SettingsTabLoading',
    setup: () => () =>
      h(
        SettingsPage,
        { loading: !failed },
        failed
          ? () =>
              h(
                'p',
                { class: 'py-16 text-center text-p-base text-ink-gray-6' },
                __('This tab could not load. Reload the page and try again.'),
              )
          : undefined,
      ),
  })
}

// One async component per tab for the whole session: a second open reuses
// the loaded chunk and shows no loading state.
const bodies = new Map<string, Component>()

function bodyOf(tab: SettingsTab): Component {
  const loaded = bodies.get(tab.id)
  if (loaded) return loaded
  const body = defineAsyncComponent({
    loader: tab.body,
    loadingComponent: placeholder(tab, false),
    errorComponent: placeholder(tab, true),
    delay: 0,
  })
  bodies.set(tab.id, body)
  return body
}
</script>

<script setup lang="ts">
import { computed, provide } from 'vue'

import { SETTINGS_TAB_TITLE } from '@/platform/settings'

const props = defineProps<{ tab: SettingsTab }>()
const body = computed(() => bodyOf(props.tab))
provide(
  SETTINGS_TAB_TITLE,
  computed(() => props.tab.label()),
)
</script>
