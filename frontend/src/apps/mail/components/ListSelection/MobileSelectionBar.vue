<template>
  <!-- A phone list's action bar while selecting: an island where Mail's bottom bar floats, which
       steps aside for it. The header above stays as it is, so entering or leaving selection never
       shifts the list. ✕ and the count, then everything that is done to the mail (read, archive,
       junk, trash), then More. Select All floats over its right end, where Compose stands over the
       bottom bar, until there is nothing left to select: ✕ is how to empty it. Teleported to Mail's
       overlay layer: inside the layout's `isolate` stacking context, no z-index could beat the
       page. More holds the rest in the toolbar's groups, each set apart: any action the bar had no
       room for (see phoneBar), where the mail is filed
       (any `extraOptions`; one with `options` of its own opens them as a sheet chained from More),
       and what keeps it to come back to (Snooze, Pin, Star). It slides away while the list scrolls
       down (`phoneBarsAway`). -->
  <Teleport :to="overlayLayer ?? 'body'">
    <div
      v-if="open"
      ref="shell"
      :class="{ 'invisible translate-y-full': away }"
      class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-end gap-3 transition-[transform,visibility] duration-200 ease-out px-3.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
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
          class="bg-surface-gray-3 active:bg-surface-gray-4 flex h-11 shrink-0 items-center gap-1 rounded-full px-3 transition active:scale-95"
          @click="emit('toggleAll', false)"
        >
          <X class="text-ink-gray-7 size-5" />
          <!-- Three digits' room, so the pill and the actions after it hold still from 1 to 999:
               a tabular digit is about 9.3px here, a little wider than a ch, so the room is set in
               pixels. -->
          <span
            class="text-ink-gray-8 min-w-7 text-center text-base !font-medium tabular-nums"
            aria-live="polite"
          >
            {{ count }}
          </span>
        </button>
        <!-- One action and no More (Drafts' Discard): the bar has room to say what it does, which a
             bin alone leaves to guess, so it says it in a word. At the far end, where the buttons
             stand. -->
        <button
          v-if="buttons.length === 1"
          type="button"
          class="text-ink-gray-8 active:bg-surface-gray-2 ml-auto flex h-11 shrink-0 items-center rounded-full px-4 text-base !font-medium transition active:scale-95"
          @click="buttons[0].onClick"
        >
          {{ buttons[0].label }}
        </button>
        <!-- Six columns at most, More among them (see phoneBar), sharing the room after the count:
             one width however many there are, so the spacing holds, the buttons in the last ones.
             The line setting them apart from the count goes with the first. -->
        <div v-else class="ml-3 grid min-w-0 flex-1 grid-cols-6 gap-0.5">
          <button
            v-for="(button, i) in buttons"
            :key="button.key"
            type="button"
            :aria-label="button.label"
            class="text-ink-gray-7 active:bg-surface-gray-2 relative flex h-11 min-w-0 items-center justify-center rounded-full transition active:scale-95"
            :style="
              i === 0 ? { gridColumnStart: PHONE_BAR_BUTTONS + 1 - buttons.length } : undefined
            "
            @click="button.onClick"
          >
            <span
              v-if="i === 0"
              class="absolute -left-1.5 top-1/2 h-6 -translate-y-1/2 border-l"
              aria-hidden="true"
            />
            <component :is="button.icon" class="size-5 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <AdaptiveDropdown v-model:open="showMore" :options="moreOptions" />
  <AdaptiveDropdown
    v-model:open="chainedOpen"
    :options="chained?.options ?? []"
    :title="chained?.title"
  />
</template>

<script setup lang="ts">
import { usePortalTarget } from 'frappe-ui'
import { Ellipsis, SquareCheck, X } from 'lucide-vue-next'
import { computed, ref, watch, type Component } from 'vue'

import { liftToastsOver, usePhoneBarsAway } from '@/apps/mail/composables/phoneBarsAway'
import { PHONE_BAR_BUTTONS, phoneBar, type SelectAction } from '@/apps/mail/utils/selectActions'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'

type MenuOption = {
  label: string
  icon?: string | Component
  onClick?: () => void
  drillsIn?: boolean
}
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
const shell = ref<HTMLElement | null>(null)
liftToastsOver(shell)
const showMore = ref(false)
// What the chained sheet shows outlives its closing, or the sheet would empty as it slides away.
const chained = ref<{ title: string; options: MenuOption[] } | null>(null)
const chainedOpen = ref(false)
// Its sheets sit outside the bar so they can slide away whole; they still go with it when the
// selection empties some other way (a row unticked, the list changing), so nothing acts on none.
watch(
  () => open,
  (shown) => {
    if (shown) return
    showMore.value = false
    chainedOpen.value = false
  },
)

const visible = computed(() => actions.filter((a) => a.condition()))
const inGroup = (group: SelectAction['group']) => visible.value.filter((a) => a.group === group)
const keeping = computed(() => [...inGroup('later'), ...inGroup('selection')])
const bar = computed(() =>
  phoneBar(inGroup('act'), extraOptions.length > 0 || keeping.value.length > 0),
)
const plain = (a: SelectAction): MenuOption => ({
  label: a.label,
  icon: a.icon,
  onClick: a.onClick,
  // One that asks something first (Snooze: until when) asks in a sheet of its own.
  drillsIn: !!a.menu,
})
// What the bar had no button for comes first: it is done to the mail, as the buttons are.
const moreOptions = computed(() => {
  const filing = extraOptions.map((option) => ({
    label: option.label,
    icon: option.icon,
    onClick: option.options
      ? () => {
          chained.value = { title: option.label, options: option.options! }
          chainedOpen.value = true
        }
      : option.onClick,
    drillsIn: !!option.options,
  }))
  return [bar.value.folded.map(plain), filing, keeping.value.map(plain)].flatMap((options) =>
    options.length ? [{ group: '', options }] : [],
  )
})
const buttons = computed(() => [
  ...bar.value.buttons.map((action) => ({
    key: action.label,
    label: action.shortLabel,
    icon: action.icon,
    onClick: action.onClick,
  })),
  ...(moreOptions.value.length
    ? [{ key: 'more', label: __('More'), icon: Ellipsis, onClick: () => (showMore.value = true) }]
    : []),
])
</script>
