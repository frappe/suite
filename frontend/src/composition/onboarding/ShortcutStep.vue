<!--
  Teaches the command menu by doing: pressing the real shortcut completes the step,
  and picking a command from the menu shows where it leads.
  Its Mod+K opens the practice menu. The suite's own menu is not mounted on
  onboarding pages (route meta `onboarding`), so nothing else answers the shortcut.
-->
<script setup lang="ts">
import { useKeyboardShortcut } from 'frappe-ui'
import { ref } from 'vue'

import { MOD_KEY } from './onboarding'
import PracticePalette from './PracticePalette.vue'

defineProps<{ admin?: boolean }>()
const learned = defineModel<boolean>('learned', { required: true })
const open = ref(false)
const picked = ref('')

useKeyboardShortcut([
  {
    combo: 'Mod+K',
    description: __('Search Suite'),
    allowInInput: true,
    handler: () => {
      open.value = true
      learned.value = true
    },
  },
])

function onPick(label: string) {
  picked.value = label
  learned.value = true
}
</script>

<template>
  <div class="flex flex-col items-center gap-5 py-4">
    <button
      type="button"
      class="flex items-center gap-2 rounded-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
      :aria-label="__('Press {0} K', [MOD_KEY])"
      @click="open = true"
    >
      <kbd class="keycap" :class="{ pressed: open }">{{ MOD_KEY }}</kbd>
      <kbd class="keycap" :class="{ pressed: open }">{{ 'K' }}</kbd>
    </button>
    <p v-if="learned" class="flex items-center gap-1.5 text-center text-base text-ink-gray-8">
      <span class="lucide-circle-check size-4 shrink-0 text-ink-green-5" aria-hidden="true" />
      <template v-if="picked">
        {{ __('That was easy. “{0}” is one keystroke away from anywhere.', [picked]) }}
      </template>
      <template v-else>
        {{ __('That’s it. Press {0} K from anywhere to search Suite.', [MOD_KEY]) }}
      </template>
    </p>
    <p v-else class="text-base text-ink-gray-5">{{ __('Try it now') }}</p>
  </div>
  <PracticePalette v-model:open="open" :admin="admin" @pick="onPick" />
</template>

<style scoped>
.keycap {
  display: inline-flex;
  min-width: 64px;
  height: 64px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border-radius: 14px;
  font-family: inherit;
  font-size: 26px;
  font-weight: 500;
  color: var(--ink-gray-8, currentColor);
  background: linear-gradient(180deg, rgb(255 255 255 / 0.9), rgb(240 240 240 / 0.9));
  border: 1px solid rgb(0 0 0 / 0.1);
  box-shadow:
    inset 0 -3px 0 rgb(0 0 0 / 0.08),
    0 1px 2px rgb(0 0 0 / 0.08);
  transition:
    transform 90ms ease,
    box-shadow 90ms ease;
}
.keycap.pressed {
  transform: translateY(2px);
  box-shadow: inset 0 -1px 0 rgb(0 0 0 / 0.08);
}
[data-theme='dark'] .keycap {
  color: #eee;
  background: linear-gradient(180deg, #2c2c2c, #222);
  border-color: rgb(255 255 255 / 0.08);
  box-shadow:
    inset 0 -3px 0 rgb(0 0 0 / 0.4),
    inset 0 1px 0 rgb(255 255 255 / 0.06);
}
@media (prefers-reduced-motion: reduce) {
  .keycap {
    transition: none;
  }
}
</style>
