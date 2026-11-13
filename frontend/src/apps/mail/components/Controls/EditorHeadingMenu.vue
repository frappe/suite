<template>
  <!-- A popover rather than the kit's inline heading row, which would not fit a narrow composer. -->
  <Popover :auto-focus="false">
    <template #trigger>
      <Button
        size="xs"
        variant="ghost"
        class="aria-pressed:bg-surface-gray-3"
        :icon="shown.icon"
        :label="shown.label"
        :aria-pressed="!!active"
      />
    </template>
    <template #default="{ close }">
      <div class="flex flex-col gap-0.5 p-1">
        <Button
          v-for="heading in HEADINGS"
          :key="heading.label"
          variant="ghost"
          class="justify-start aria-pressed:bg-surface-gray-3"
          :icon-left="heading.icon"
          :label="heading.label"
          :aria-pressed="heading === active"
          @mousedown.prevent
          @click="pick(heading, close)"
        />
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { Button, Popover } from 'frappe-ui'
import { H2, H3, H4, H5, H6, type CommandMenuItem, type TiptapEditor } from 'frappe-ui/editor'
import { computed, ref, watch } from 'vue'

const { editor } = defineProps<{ editor: TiptapEditor }>()

const HEADINGS: CommandMenuItem[] = [H2, H3, H4, H5, H6]

// Plain editor state, which Vue doesn't track: the menu follows the caret by counting transactions.
const version = ref(0)
watch(
  () => editor,
  (current, _previous, onCleanup) => {
    const bump = () => version.value++
    current.on('transaction', bump)
    onCleanup(() => current.off('transaction', bump))
  },
  { immediate: true },
)

const active = computed(() => {
  void version.value
  return HEADINGS.find((heading) => heading.isActive?.(editor))
})
const shown = computed(() => active.value ?? H2)

const pick = (heading: CommandMenuItem, close: () => void) => {
  heading.action(editor)
  close()
}
</script>
