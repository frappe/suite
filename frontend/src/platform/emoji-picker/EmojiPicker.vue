<template>
  <Popover
    :open="isOpen"
    bare
    :side="side"
    :align="align"
    :auto-focus="!openOnHover"
    @update:open="setPickerOpen"
  >
    <template #trigger="{ setOpen, open }">
      <slot
        v-bind="{
          open,
          toggle: () => setOpen(!open),
          press,
          hover: { onPointerenter: scheduleOpen, onPointerleave: scheduleClose },
        }"
      >
        <span class="text-base"> {{ modelValue || '' }} </span>
      </slot>
    </template>
    <template #default="{ close }">
      <div
        v-if="reaction"
        class="bg-surface-base flex items-center justify-center gap-0.5 rounded-full p-1 shadow-sm"
        @pointerenter="cancelClose"
        @pointerleave="scheduleClose"
      >
        <button
          v-for="r in reactionEmojis"
          :key="r"
          class="hover:bg-surface-gray-2 focus-visible:bg-surface-gray-2 flex size-7 items-center justify-center rounded-full text-xl leading-none focus:outline-none"
          @click="() => (selectEmoji(r), close())"
        >
          {{ r }}
        </button>
        <Button
          class="rounded-full"
          icon="lucide-plus"
          :aria-label="__('More reactions')"
          @click.stop="showFullPicker"
        />
      </div>
      <EmojiGrid v-else :picker @select="selectAndClose" />
    </template>
  </Popover>
</template>
<script setup lang="ts">
import type { Picker } from 'emoji-mart'
import { Button, Popover } from 'frappe-ui'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import EmojiGrid from './EmojiGrid.vue'
import { prepareEmojiPicker } from './prepareEmojiPicker'

const { openOnHover = false } = defineProps<{
  openOnHover?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}>()
const emit = defineEmits<{ select: [emoji: string] }>()

const emoji = defineModel<string>()
const reaction = defineModel<boolean>('reaction')

const OPEN_DELAY_MS = 150
const CLOSE_DELAY_MS = 300

// Opening on hover is for a mouse. A touch has no hover to end, so it still goes by tapping.
const isMouse = (event: PointerEvent) => event.pointerType === 'mouse'

const isOpen = ref(false)
const picker = shallowRef<typeof Picker>()
let openRequest = 0
let hoverTimer: ReturnType<typeof setTimeout> | undefined
const cancelClose = () => clearTimeout(hoverTimer)
onBeforeUnmount(() => {
  cancelClose()
  openRequest++
})

const scheduleOpen = (event: PointerEvent) => {
  if (!openOnHover || !isMouse(event)) return
  void prepareEmojiPicker()
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => (isOpen.value = true), OPEN_DELAY_MS)
}

// Crossing the gap from the button to the palette is what the delay is for. The full list stays
// open: it has a search box to type in, and is dismissed by clicking away.
const scheduleClose = (event: PointerEvent) => {
  if (!openOnHover || !isMouse(event)) return
  clearTimeout(hoverTimer)
  if (reaction.value) hoverTimer = setTimeout(() => setPickerOpen(false), CLOSE_DELAY_MS)
}

// The popover's own trigger toggles on a press, which is right for a tap or a key. A mouse that
// hovered and then clicks wants what it already sees, so it is held open against that toggle.
const press = (event: PointerEvent) => {
  clearTimeout(hoverTimer)
  if (openOnHover && isMouse(event)) isOpen.value = true
}

// It opens on the short palette each time, whichever view it was left on.
watch(isOpen, (open) => {
  if (open && openOnHover) reaction.value = true
})

const reactionEmojis = ref(['👍', '❤️', '😂', '😮', '😢', '🙏'])

function selectEmoji(value: string) {
  emoji.value = value
  emit('select', value)
}

function setPickerOpen(open: boolean) {
  if (!open) {
    openRequest++
    isOpen.value = false
  } else if (openOnHover || reaction.value) {
    if (openOnHover) reaction.value = true
    isOpen.value = true
  } else {
    void showFullPicker()
  }
}

async function showFullPicker() {
  const request = ++openRequest
  const prepared = await prepareEmojiPicker()
  if (request !== openRequest) return
  picker.value = prepared
  if (reaction.value) reaction.value = false
  isOpen.value = true
}

function selectAndClose(value: string) {
  selectEmoji(value)
  setPickerOpen(false)
}
</script>
