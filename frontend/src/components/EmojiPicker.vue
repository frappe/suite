<template>
  <Popover v-model:open="isOpen" bare :side="side" :align="align" :auto-focus="!openOnHover">
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
          @click.stop="() => (reaction = false)"
        />
      </div>
      <div v-else class="bg-surface-base max-w-max transform rounded-6 px-4 sm:px-0">
        <div
          class="relative max-h-96 overflow-y-auto rounded-6 pb-3 shadow-2xl ring-1 ring-black ring-opacity-5"
        >
          <div class="flex gap-2 px-3 pb-1 pt-3">
            <div class="flex-1">
              <FormControl
                v-model="search"
                :placeholder="__('Search by keyword')"
                :debounce="300"
              />
            </div>
            <Button @click="setRandom">{{ __('Random') }}</Button>
          </div>
          <div class="w-[calc(100vw-2rem)] sm:w-96"></div>
          <div v-for="(emojis, group) in emojiGroups" :key="group" class="px-3">
            <div class="bg-surface-base text-ink-gray-6 sticky top-0 pb-2 pt-3 text-sm">
              {{ group }}
            </div>
            <div class="grid w-full grid-cols-8 place-items-center sm:w-96 sm:grid-cols-12">
              <button
                v-for="_emoji in emojis"
                :key="_emoji.description"
                class="hover:bg-surface-gray-2 h-8 w-8 rounded-4 p-1 text-3xl focus:outline-none focus:ring focus:ring-blue-200"
                :title="_emoji.description"
                @click="() => (selectEmoji(_emoji.emoji), close())"
              >
                {{ _emoji.emoji }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </Popover>
</template>
<script setup lang="ts">
import { Button, FormControl, Popover } from 'frappe-ui'
import { gemoji, type Gemoji } from 'gemoji'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

const { openOnHover = false } = defineProps<{
  openOnHover?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}>()
const emit = defineEmits<{ select: [emoji: string] }>()

const search = ref('')
const emoji = defineModel<string>()
const reaction = defineModel<boolean>('reaction')

const OPEN_DELAY_MS = 150
const CLOSE_DELAY_MS = 300

// Opening on hover is for a mouse. A touch has no hover to end, so it still goes by tapping.
const isMouse = (event: PointerEvent) => event.pointerType === 'mouse'

const isOpen = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | undefined
const cancelClose = () => clearTimeout(hoverTimer)
onBeforeUnmount(cancelClose)

const scheduleOpen = (event: PointerEvent) => {
  if (!openOnHover || !isMouse(event)) return
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => (isOpen.value = true), OPEN_DELAY_MS)
}

// Crossing the gap from the button to the palette is what the delay is for. The full list stays
// open: it has a search box to type in, and is dismissed by clicking away.
const scheduleClose = (event: PointerEvent) => {
  if (!openOnHover || !isMouse(event)) return
  clearTimeout(hoverTimer)
  if (reaction.value) hoverTimer = setTimeout(() => (isOpen.value = false), CLOSE_DELAY_MS)
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

const emojiGroups = computed(() => {
  const groups: Record<string, Gemoji[]> = {}
  for (const _emoji of gemoji) {
    if (search.value) {
      const keywords = [_emoji.description, ..._emoji.names, ..._emoji.tags].join(' ').toLowerCase()
      if (!keywords.includes(search.value.toLowerCase())) {
        continue
      }
    }

    const group = (groups[_emoji.category] ??= [])
    group.push(_emoji)
  }
  if (!Object.keys(groups).length) {
    groups[__('No results')] = []
  }
  return groups
})

function selectEmoji(value: string) {
  emoji.value = value
  emit('select', value)
}

function setRandom() {
  const random = gemoji[Math.floor(Math.random() * gemoji.length)]
  if (random) selectEmoji(random.emoji)
}

defineExpose({ setRandom })
</script>
