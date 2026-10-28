<template>
  <Tooltip :side>
    <template #content>
      {{ label }}<span v-if="shortcut" class="ms-2 opacity-60">{{ formatShortcut(shortcut) }}</span>
      <p v-if="description" class="max-w-56 opacity-60">{{ description }}</p>
    </template>
    <button
      type="button"
      :class="$slots.default ? ['writer-select', compact && 'writer-select-compact'] : toolClass"
      :aria-label="label"
      :aria-keyshortcuts="shortcut && formatShortcut(shortcut, false).replace('Ctrl', 'Control')"
      :aria-pressed="pressed"
      :disabled
      v-bind="$attrs"
    >
      <slot>
        <span :class="[icon, compact ? 'size-3.5' : 'size-4']" aria-hidden="true" />
      </slot>
    </button>
  </Tooltip>
</template>

<script setup lang="ts">
import { Tooltip } from 'frappe-ui'
import { computed } from 'vue'

import { formatShortcut } from './formatting'

// Tooltip drops attributes, so listeners such as @click, and a menu's trigger props, go to the button
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    /** What the button does, when the label alone does not say */
    description?: string
    /** Without it, the default slot fills a select-style button */
    icon?: string
    /** A Tiptap key binding, such as `Mod-b` */
    shortcut?: string
    /** Unset for buttons that do not toggle, so they carry no `aria-pressed` */
    pressed?: boolean
    disabled?: boolean
    /** The bubble menu's 24px size */
    compact?: boolean
    side?: 'top' | 'bottom'
  }>(),
  { description: undefined, icon: undefined, shortcut: undefined, pressed: undefined, side: 'top' },
)

const toolClass = computed(() => ['writer-tool', props.compact ? 'size-6' : 'size-7'])
</script>
