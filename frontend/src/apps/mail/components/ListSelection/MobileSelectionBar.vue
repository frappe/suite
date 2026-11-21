<template>
  <!-- A phone list's action bar while selecting: an island where Mail's bottom bar floats, which
       steps aside for it. The header above stays as it is, so entering or leaving selection never
       shifts the list. ✕ and the count, then everything that is done to the mail (read, archive,
       junk, trash), then More. Select All floats over its right end, where Compose stands over the
       bottom bar, until there is nothing left to select: ✕ is how to empty it. Teleported to Mail's
       overlay layer: inside the layout's `isolate` stacking context, no z-index could beat the
       page. More holds the rest in the toolbar's groups, each set apart: where the mail is filed
       (any `extraOptions`; one with `options` of its own opens them as a sheet chained from More),
       and what keeps it to come back to (Snooze, Pin, Star). It slides away while the list scrolls
       down (`phoneBarsAway`). -->
  <Teleport :to="overlayLayer ?? 'body'">
    <div
      v-if="open"
      :class="{ 'translate-y-full': away }"
      class="pointer-events-none fixed inset-x-0 bottom-[var(--suite-phone-nav-height,0px)] z-20 flex flex-col items-end gap-3 transition-transform duration-200 ease-out px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <button
        v-if="!allSelected"
        type="button"
        class="bg-surface-elevation-2 active:bg-surface-gray-2 text-ink-gray-8 pointer-events-auto flex h-10 items-center gap-2 rounded-full border pl-3 pr-4 text-base !font-medium shadow-xl transition active:scale-95"
        @click="emit('toggleAll', true)"
      >
        <SquareCheck class="text-ink-gray-7 size-4" />
        {{ __('Select All') }}
      </button>
      <div
        role="toolbar"
        :aria-label="__('Selected mail')"
        class="bg-surface-elevation-2 pointer-events-auto flex h-14 w-full items-center gap-0.5 rounded-full border p-1.5 shadow-xl"
      >
        <button
          type="button"
          :aria-label="__('Clear selection')"
          class="bg-surface-gray-3 active:bg-surface-gray-4 flex h-11 shrink-0 items-center gap-2 rounded-full pl-3 pr-4 transition active:scale-95"
          @click="emit('toggleAll', false)"
        >
          <X class="text-ink-gray-7 size-5" />
          <span class="text-ink-gray-8 text-base !font-medium tabular-nums" aria-live="polite">
            {{ count }}
          </span>
        </button>
        <span class="ml-auto shrink-0 px-1" aria-hidden="true">
          <span class="block h-6 border-l" />
        </span>
        <!-- Each takes an even share of the room left, up to a full round button; the rest stays between
             the count and the actions, which keep to the right, by More. -->
        <button
          v-for="action in acts"
          :key="action.label"
          type="button"
          :aria-label="stripShortcutHint(action.label)"
          class="text-ink-gray-7 active:bg-surface-gray-2 flex h-11 min-w-0 max-w-11 flex-1 items-center justify-center rounded-full transition active:scale-95"
          @click="action.onClick"
        >
          <component :is="action.icon" class="size-5 shrink-0" />
        </button>
        <button
          v-if="moreOptions.length"
          type="button"
          :aria-label="__('More')"
          class="text-ink-gray-7 active:bg-surface-gray-2 flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-95"
          @click="showMore = true"
        >
          <Ellipsis class="size-5" />
        </button>
      </div>
    </div>
  </Teleport>

  <AdaptiveDropdown v-model:open="showMore" :options="moreOptions" />
  <AdaptiveDropdown
    :open="!!chained"
    :options="chained?.options ?? []"
    :title="chained?.title"
    @update:open="(open: boolean) => !open && (chained = null)"
  />
</template>

<script setup lang="ts">
import { usePortalTarget } from 'frappe-ui'
import { Ellipsis, SquareCheck, X } from 'lucide-vue-next'
import { computed, ref, type Component } from 'vue'

import { usePhoneBarsAway } from '@/apps/mail/composables/phoneBarsAway'
import type { SelectAction } from '@/apps/mail/utils/selectActions'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import { stripShortcutHint } from '@/utils/actionLabel'

type MenuOption = { label: string; icon?: string | Component; onClick?: () => void }
// A More entry: an action, or a menu of its own (the folder menus) that opens as a chained sheet.
type ExtraOption = {
  label: string
  icon: string | Component
  onClick?: () => void
  options?: MenuOption[]
}

const {
  open,
  actions,
  extraOptions = [],
  count,
  allSelected,
} = defineProps<{
  open: boolean
  actions: SelectAction[]
  extraOptions?: ExtraOption[]
  count: number
  allSelected: boolean
}>()
const emit = defineEmits<{ toggleAll: [selected: boolean] }>()

const overlayLayer = usePortalTarget()
const away = usePhoneBarsAway()
const showMore = ref(false)
const chained = ref<{ title: string; options: MenuOption[] } | null>(null)

const visible = computed(() => actions.filter((a) => a.condition()))
const acts = computed(() => visible.value.filter((a) => a.group === 'act'))
const plain = (a: SelectAction): MenuOption => ({
  label: a.label,
  icon: a.icon,
  onClick: a.onClick,
})
const moreOptions = computed(() => {
  const inGroup = (group: SelectAction['group']) =>
    visible.value.filter((a) => a.group === group).map(plain)
  const filing = extraOptions.map((option) => ({
    label: option.label,
    icon: option.icon,
    onClick: option.options
      ? () => (chained.value = { title: option.label, options: option.options! })
      : option.onClick,
  }))
  return [filing, [...inGroup('later'), ...inGroup('selection')]].flatMap((options) =>
    options.length ? [{ group: '', options }] : [],
  )
})
</script>
