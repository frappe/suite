<template>
  <div
    :class="showText ? (alignment === 'left' ? 'min-h-[4.5rem] py-4' : 'min-h-[4.5rem] p-4') : ''"
  >
    <div v-if="error" class="bg-red-500/10 border border-red-500/30 rounded-6 p-4">
      <p class="text-sm text-red-400">
        <lucide-alert-circle class="w-4 h-4 inline mr-2" />
        {{ error }}
      </p>
    </div>
    <div
      v-else-if="!loading && participants.length > 0"
      class="flex"
      :class="alignment === 'left' ? 'flex-row items-center gap-4' : 'flex-col items-center'"
    >
      <div
        class="relative isolate flex -space-x-2"
        :class="alignment === 'center' ? 'mx-auto' : ''"
      >
        <div
          v-for="(participant, index) in displayedParticipants"
          :key="participant.user_id"
          :style="{ zIndex: avatarZIndex(index) }"
        >
          <MeetAvatar
            class="border-2 border-[var(--surface-base)] ring-0 rounded-full"
            :image="participant.avatar_url"
            :label="participant.full_name"
            :size="size"
            shape="circle"
          />
        </div>
        <div v-if="extraCount > 0" :style="{ zIndex: extraAvatarZIndex }">
          <div
            class="border-2 border-[var(--surface-base)] ring-0 rounded-full bg-surface-gray-2 flex items-center justify-center text-ink-gray-5 text-base-semibold"
            :class="extraAvatarWrapperClasses"
          >
            +{{ extraCount }}
          </div>
        </div>
      </div>
      <div
        v-if="showText"
        class="text-base text-ink-gray-7"
        :class="alignment === 'center' ? 'mt-4' : ''"
      >
        <span v-if="displayedParticipants.length > 0">{{ presenceText }}</span>
      </div>
    </div>
    <div v-else-if="!loading && showText" class="flex h-10 items-center">
      <p class="text-base text-ink-gray-7">{{ __("You'll be the first to join this meeting") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import MeetAvatar from './MeetAvatar.vue'

type AvatarGroupSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl'
type StackDirection = 'left' | 'right'

interface AvatarGroupParticipant {
  user_id: string
  full_name: string
  avatar_url?: string
}

interface Props {
  participants: AvatarGroupParticipant[]
  error: string | null
  loading?: boolean
  maxDisplayed: number
  size?: AvatarGroupSize
  stackDirection?: StackDirection
  alignment?: 'left' | 'center'
  showText?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  participants: () => [],
  error: '',
  loading: false,
  maxDisplayed: 3,
  size: '2xl',
  stackDirection: 'right',
  alignment: 'center',
  showText: false,
})

const extraSizeClasses: Record<AvatarGroupSize, string> = {
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-6 w-6 text-xs',
  lg: 'h-7 w-7 text-xs',
  xl: 'h-8 w-8 text-sm',
  '2xl': 'h-10 w-10',
}

const extraAvatarWrapperClasses = computed(() => extraSizeClasses[props.size])

const displayedParticipants = computed(() => props.participants.slice(0, props.maxDisplayed))

const extraCount = computed(() => Math.max(0, props.participants.length - props.maxDisplayed))

const avatarZIndex = (index: number) =>
  props.stackDirection === 'right'
    ? index + 1
    : displayedParticipants.value.length - index + (extraCount.value ? 1 : 0)

const extraAvatarZIndex = computed(() =>
  props.stackDirection === 'right' ? displayedParticipants.value.length + 1 : 1,
)

const formattedNames = computed((): string => {
  const names = displayedParticipants.value.map((p) => p.full_name)
  const participantLength = props.participants.length
  if (participantLength === 0) return ''
  if (extraCount.value > 0) return names.join(', ')
  if (participantLength === 1) return names[0]
  if (participantLength === 2) return __('{0} and {1}', [names[0], names[1]])
  if (participantLength === 3) return __('{0}, {1} and {2}', [names[0], names[1], names[2]])
  return names.join(', ')
})
const presenceText = computed(() => {
  const names = formattedNames.value
  if (extraCount.value === 1)
    return __('{0} and {1} other are in the meeting', [names, extraCount.value])
  if (extraCount.value > 1)
    return __('{0} and {1} others are in the meeting', [names, extraCount.value])
  return displayedParticipants.value.length === 1
    ? __('{0} is in the meeting', [names])
    : __('{0} are in the meeting', [names])
})
</script>
