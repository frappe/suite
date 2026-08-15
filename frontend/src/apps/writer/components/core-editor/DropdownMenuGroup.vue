<script setup>
import { ref, computed, watch } from 'vue'
import { Popover, Button } from 'frappe-ui'
import LucideChevronDown from '~icons/lucide/chevron-down'

const props = defineProps({
  // Passed by MenuItems.vue for all component items
  editor: Object,
  items: { type: Array, default: () => [] },
  // Fallback icon/label when no item is active
  defaultIcon: [String, Object],
  defaultLabel: { type: String, default: '' },
  // Show the active item's name in the trigger instead of only its icon.
  showLabel: { type: Boolean, default: false },
})

const isOpen = ref(false)

// Bump version on every editor transaction so active icon stays in sync.
const version = ref(0)
watch(
  () => props.editor,
  (editor, _old, onCleanup) => {
    if (typeof editor?.on !== 'function') return
    const bump = () => version.value++
    editor.on('transaction', bump)
    onCleanup(() => editor.off('transaction', bump))
  },
  { immediate: true },
)

const activeItem = computed(() => {
  void version.value
  if (!props.editor) return null
  return props.items.find((item) => item.isActive?.(props.editor)) ?? null
})

const triggerIcon = computed(() => activeItem.value?.icon ?? props.defaultIcon)
const triggerLabel = computed(() => activeItem.value?.label ?? props.defaultLabel)

const visibleItems = computed(() => {
  void version.value
  if (!props.editor) return props.items
  return props.items.filter((item) => item.isAvailable?.(props.editor) !== false)
})

function isPressed(item) {
  void version.value
  return !!props.editor && item.isActive?.(props.editor) === true
}

function run(item, event) {
  if (!props.editor || item.isDisabled?.(props.editor)) return
  item.action(props.editor, { event, trigger: event.currentTarget })
  isOpen.value = false
}
</script>

<template>
  <!-- MenuItems.vue renders the toolbar Button via #default slot, but we
       ignore that slot and render our own button so the icon can be reactive. -->
  <Popover v-model:open="isOpen" placement="bottom-start">
    <template #trigger>
      <!-- Content goes in the default slot, not the `icon` prop: an `icon`
           Button is square, and this trigger has to fit icon + chevron. -->
      <Button
        size="xs"
        variant="ghost"
        :aria-label="triggerLabel"
        :tooltip="triggerLabel"
        class="aria-pressed:bg-surface-gray-3"
        :aria-pressed="isOpen"
      >
        <span class="flex items-center gap-1">
          <span v-if="showLabel" class="truncate">{{ triggerLabel }}</span>
          <!-- frappe-ui items carry a `lucide-*` class string; ours carry a
               component. Button resolves both, but only through its icon
               props, which we can't use here. -->
          <span
            v-else-if="typeof triggerIcon === 'string'"
            :class="[triggerIcon, 'size-4']"
            aria-hidden="true"
          />
          <component :is="triggerIcon" v-else class="size-4" />
          <LucideChevronDown class="size-3 text-ink-gray-5" />
        </span>
      </Button>
    </template>
    <div class="flex flex-col p-1 w-40">
      <Button
        v-for="item in visibleItems"
        :key="item.label"
        variant="ghost"
        size="sm"
        :icon-left="item.icon"
        :label="item.label"
        class="!justify-start w-full aria-pressed:bg-surface-gray-3"
        :aria-pressed="isPressed(item)"
        @click="run(item, $event)"
      />
    </div>
  </Popover>
</template>
