<!--
  The tweak panel: evaluation scaffolding that switches each Drive UI change
  on or off. It does not block the page. On a phone it sits at the top, clear
  of the upload tracker; from `md` up it docks to the right edge and ends
  above the tracker while the tracker shows. Where the Drive sidebar's Tweaks
  item is out of reach (a phone, a document), a floating button opens it.
-->
<template>
  <Button
    v-if="!isTweakPanelOpen && route.name !== 'slides-slideshow'"
    icon="lucide-flask-conical"
    size="md"
    variant="outline"
    :aria-label="__('Tweaks')"
    class="fixed bottom-20 right-3 z-10 !rounded-full shadow-lg md:bottom-4 md:right-4"
    :class="hasSidebar ? 'md:hidden' : ''"
    @click="isTweakPanelOpen = true"
  />
  <aside
    v-if="isTweakPanelOpen"
    data-slot="tweak-panel"
    :aria-label="__('Tweaks')"
    class="fixed inset-x-2 top-14 z-30 flex max-h-[50dvh] flex-col overflow-hidden rounded-6 border border-outline-gray-1 bg-surface-elevation-2 text-ink-gray-8 shadow-2xl md:inset-x-auto md:right-2 md:max-h-none md:w-80"
    :class="isTrackerShown ? 'md:bottom-[26rem]' : 'md:bottom-2'"
  >
    <header class="flex shrink-0 items-center gap-2 border-b border-outline-gray-1 py-2 pl-4 pr-2">
      <div class="min-w-0 flex-1">
        <h2 class="text-base-semibold">{{ __('Tweaks') }}</h2>
        <p class="mt-0.5 text-sm text-ink-gray-5 tabular-nums">
          {{ __('{0} of {1} on', [onCount, tweaks.length]) }}
        </p>
      </div>
      <Button :label="__('All on')" @click="setTweaks(ids, true)" />
      <Button :label="__('All off')" @click="setTweaks(ids, false)" />
      <Button
        variant="ghost"
        icon="lucide-x"
        :aria-label="__('Close tweaks')"
        @click="isTweakPanelOpen = false"
      />
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
      <section v-for="group in groups" :key="group.name">
        <h3 class="px-2 pb-1 pt-4 text-sm text-ink-gray-5">{{ group.name }}</h3>
        <div
          v-for="tweak in group.tweaks"
          :key="tweak.id"
          class="flex items-start gap-2 rounded-4 px-2 py-2"
          :class="tweak.ready ? 'hover:bg-surface-gray-2' : ''"
        >
          <span class="w-5 shrink-0 text-sm text-ink-gray-5 tabular-nums">{{ tweak.item }}</span>
          <label
            :for="`tweak-${tweak.id}`"
            class="min-w-0 flex-1"
            :class="tweak.ready ? 'cursor-pointer' : ''"
          >
            <span
              class="block text-sm"
              :class="tweak.ready ? 'text-ink-gray-8' : 'text-ink-gray-6'"
            >
              {{ tweak.label }}
            </span>
            <span :id="`tweak-${tweak.id}-about`" class="mt-1 block text-p-xs text-ink-gray-5">
              {{ tweak.description }}
            </span>
            <span v-if="!tweak.ready" class="mt-1 block text-xs text-ink-amber-6">
              {{ __('Not implemented yet') }}
            </span>
          </label>
          <Switch
            :id="`tweak-${tweak.id}`"
            :model-value="isTweakOn(tweak.id)"
            :disabled="!tweak.ready"
            :aria-describedby="`tweak-${tweak.id}-about`"
            @update:model-value="(on: boolean) => setTweaks([tweak.id], on)"
          />
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Button, Switch } from 'frappe-ui'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { translate as __ } from '@/platform/translation'
import { isTweakOn, setTweaks } from '@/platform/tweaks'

import { uploadQueue } from '../uploads/queue'
import { isTweakPanelOpen } from './panel'
import { tweakGroups, tweaks } from './registry'

const route = useRoute()
const queue = uploadQueue()

const ids = tweaks.map((tweak) => tweak.id)
const groups = tweakGroups
  .map((name) => ({ name, tweaks: tweaks.filter((tweak) => tweak.group === name) }))
  .filter((group) => group.tweaks.length > 0)
const onCount = computed(() => tweaks.filter((tweak) => isTweakOn(tweak.id)).length)
/** Drive's own pages show the sidebar with the Tweaks item from `md` up. */
const hasSidebar = computed(() => String(route.name ?? '').startsWith('files'))
const isTrackerShown = computed(
  () => queue.state.trackerOpen && (queue.entries.value.length > 0 || queue.state.preparing > 0),
)
</script>
