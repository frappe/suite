<!--
  Settings on a phone: a full-screen list of headings and rows. A row opens
  its tab as a full-screen page over the list.

  It is a modal dialog: focus stays inside it, and the page behind it is
  hidden from assistive technology.

  Each level owns one browser history entry, so the back gesture goes tab,
  then list, then closed; opened at a tab, it goes tab, then closed. The on-screen back arrows and Escape call
  history.back() and take the same path. Every entry carries the id of the
  open it belongs to, so an entry from an earlier open closes Settings.
-->
<template>
  <DialogRoot :open="open" @update:open="(value) => !value && back()">
    <DialogPortal>
      <DialogContent
        class="fixed inset-0 z-40 flex flex-col bg-surface-base pt-[env(safe-area-inset-top)] outline-none"
        :aria-describedby="undefined"
        @escape-key-down.prevent="back"
        @pointer-down-outside.prevent
        @focus-outside.prevent
      >
        <!-- Each level's bar is a phone page's: the round 40px Back where a list's menu button
             stands, the page's title at a list's title size, and no line under it. -->
        <div :class="BAR">
          <button type="button" :class="BACK" :aria-label="__('Close settings')" @click="back">
            <ChevronLeft class="size-5" />
          </button>
          <DialogTitle :class="TITLE">{{ __('Settings') }}</DialogTitle>
        </div>

        <div
          class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
          :inert="page ? true : undefined"
        >
          <SettingsList
            :groups="groups"
            @open="(tab) => slideChange('forward', () => openTab(tab))"
          />
        </div>

        <SettingsPhonePage :open="!!page" :title="page?.label() ?? ''" @back="back">
          <template #actions>
            <!-- Tab header actions teleport here, so they leave with the page. -->
            <div :id="SETTINGS_PAGE_ACTIONS_ID" class="flex items-center gap-2" />
          </template>
          <SettingsTabBody v-if="page" :tab="page" />
        </SettingsPhonePage>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { nextTick, onBeforeUnmount, onMounted, provide, shallowRef, watch } from 'vue'

import { slideChange } from '@/platform/page-slide'
import { settingsPageShown } from '@/platform/settings'
import { settingsPartEntries } from '@/platform/settings/partPage'
import SettingsPhonePage from '@/platform/settings/SettingsPhonePage.vue'
import { translate as __ } from '@/platform/translation'
import {
  SETTINGS_PAGE_ACTIONS_ID,
  SETTINGS_PHONE_PAGE,
  type SettingsTab,
  type VisibleSettingsGroup,
} from '@/shell/settings/settings'
import SettingsList from '@/shell/settings/SettingsList.vue'
import SettingsTabBody from '@/shell/settings/SettingsTabBody.vue'

const props = defineProps<{
  groups: readonly VisibleSettingsGroup[]
  /** The tab to open over the list once it shows: its condition may still wait on the server. */
  tab?: string
}>()
const open = defineModel<boolean>('open', { default: false })

provide(SETTINGS_PHONE_PAGE, true)

const BAR = 'flex h-14 shrink-0 items-center gap-1 px-1'
const BACK =
  'touch-target text-ink-gray-6 active:bg-surface-gray-2 flex size-10 shrink-0 items-center justify-center rounded-full'
const TITLE = 'text-ink-gray-8 min-w-0 flex-1 truncate text-3xl !font-semibold tracking-[-0.01em]'

type Level = 'list' | 'tab'
interface EntryState {
  suiteSettings?: Level
  suiteSettingsTab?: string
  /** The open this entry belongs to. */
  suiteSettingsOpen?: string
}

const page = shallowRef<SettingsTab | null>(null)
// The history entries this open pushed and has not yet left.
let depth = 0
// A new id each time Settings opens.
let openId = ''
// A tab asked for before it showed.
let pendingTab: string | undefined
// Opened at a tab (from a page that lists the settings itself, such as an app's Profile): back from
// the tab closes Settings rather than showing a list the page already showed.
let openedAtTab = false

function findTab(id: string | undefined): SettingsTab | undefined {
  return props.groups.flatMap((group) => group.tabs).find((tab) => tab.id === id)
}

function push(state: EntryState) {
  // Keep the router's own state, so vue-router sees the same position and
  // treats a pop between these entries as a no-op.
  history.pushState(
    {
      ...(history.state && typeof history.state === 'object' ? history.state : null),
      ...state,
      suiteSettingsOpen: openId,
    },
    '',
  )
  depth += 1
}

function openTab(tab: SettingsTab) {
  page.value = tab
  push({ suiteSettings: 'tab', suiteSettingsTab: tab.id })
}

function openPending() {
  const tab = findTab(pendingTab)
  // One not shown yet, as its condition waits on the server, is opened once it shows
  if (!tab) return
  pendingTab = undefined
  openTab(tab)
}

function back() {
  if (depth > 0) history.back()
  else open.value = false
}

function onPopState(event: PopStateEvent) {
  if (!open.value) return
  const state: unknown = event.state
  if (!state || typeof state !== 'object') {
    depth = 0
    page.value = null
    open.value = false
    return
  }
  const suiteSettingsOpen = 'suiteSettingsOpen' in state ? state.suiteSettingsOpen : undefined
  const suiteSettings = 'suiteSettings' in state ? state.suiteSettings : undefined
  const suiteSettingsTab =
    'suiteSettingsTab' in state && typeof state.suiteSettingsTab === 'string'
      ? state.suiteSettingsTab
      : undefined
  if (suiteSettingsOpen === openId && suiteSettings === 'tab') {
    depth = 2
    page.value = findTab(suiteSettingsTab) ?? null
  } else if (suiteSettingsOpen === openId && suiteSettings === 'list') {
    depth = 1
    // Opened at a tab from a page, back pops the tab off it as the page slid in, and closing drops
    // the list's own entry, as a close from outside does.
    if (openedAtTab)
      void slideChange('back', () => {
        page.value = null
        open.value = false
      })
    else
      void slideChange('back', () => {
        page.value = null
      })
  } else {
    // Below the list, or an entry an earlier open left behind.
    depth = 0
    page.value = null
    open.value = false
  }
}

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      if (depth > 0) return
      openId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      push({ suiteSettings: 'list' })
      pendingTab = props.tab
      openedAtTab = !!props.tab
      openPending()
    } else {
      page.value = null
      pendingTab = undefined
      openedAtTab = false
      // Closed from outside the drill-in: drop the entries it pushed. The
      // pops arrive while closed, so onPopState ignores them.
      // A part page open on the tab took a step of its own.
      const steps = depth + settingsPartEntries()
      if (steps > 0) history.go(-steps)
      depth = 0
    }
  },
  { immediate: true },
)

watch(
  () => props.groups,
  () => {
    if (open.value && pendingTab) openPending()
  },
)

// A page on screen, for a slide into it to picture (see openSettingsPage).
watch(page, (shown) => shown && void nextTick(settingsPageShown), { flush: 'post' })

onMounted(() => {
  window.addEventListener('popstate', onPopState)
  if (page.value) settingsPageShown()
})
onBeforeUnmount(() => window.removeEventListener('popstate', onPopState))
</script>
