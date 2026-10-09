<template>
  <!-- A phone list's action bar while selecting (design: 5·Selection). It covers the shell's bottom
	     nav for thumb reach, fixed over it with safe-area padding so entering or leaving selection
	     never shifts the list, and teleported to Mail's overlay layer: inside the layout's `isolate`
	     stacking context, no z-index could beat the nav. Four labelled actions and More: unlabelled
	     icons have no tooltips on touch. The rest, and any `extraOptions`, live in the More sheet. -->
  <Teleport :to="overlayLayer ?? 'body'">
    <div
      v-if="open"
      class="bg-surface-base fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)]"
    >
      <!-- flex-1 columns, like the nav underneath: equal widths keep the icons evenly spaced
			     whatever the label length. -->
      <div class="flex h-15 items-stretch">
        <button
          v-for="action in visible.slice(0, 4)"
          :key="action.label"
          class="text-ink-gray-7 flex flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] !font-semibold"
          @click="action.onClick"
        >
          <component :is="action.icon" class="h-5 w-5" />
          <span class="max-w-full truncate">{{ action.shortLabel }}</span>
        </button>
        <button
          v-if="moreOptions.length"
          class="text-ink-gray-7 flex flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] !font-semibold"
          @click="showMore = true"
        >
          <Ellipsis class="h-5 w-5" />
          <span>{{ __('More') }}</span>
        </button>
      </div>

      <AdaptiveDropdown v-model:open="showMore" :options="moreOptions" />
      <slot />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { usePortalTarget } from 'frappe-ui'
import { Ellipsis } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import type { SelectAction } from '@/apps/mail/utils/selectActions'

type Option = { label: string; icon: unknown; onClick: () => void }

const {
  open,
  actions,
  extraOptions = [],
} = defineProps<{ open: boolean; actions: SelectAction[]; extraOptions?: Option[] }>()

const overlayLayer = usePortalTarget()
const showMore = ref(false)

const visible = computed(() => actions.filter((a) => a.condition()))
const moreOptions = computed(() => [
  ...visible.value.slice(4).map((a) => ({ label: a.label, icon: a.icon, onClick: a.onClick })),
  ...extraOptions,
])
</script>
