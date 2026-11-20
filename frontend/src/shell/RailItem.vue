<template>
  <FrappeRailItem
    :label="label"
    :description="description ?? progressDescription ?? unreadDescription"
    :route="to"
    :active="resolvedActive"
    :badge="hasBadgeSlot || unreadDot ? 0 : badge"
    :badge-style="badgeStyle"
    :variant="variant"
    @click="$emit('click', $event)"
  >
    <!-- An area's duotone icon is drawn at 22 px; a slotted utility icon
         (Settings) stays a 16 px Lucide glyph. -->
    <span
      class="relative grid place-items-center"
      :class="[ICON_DOT_HOST, icon ? 'size-[22px]' : 'size-4']"
    >
      <component :is="icon" v-if="icon" class="size-[22px]" aria-hidden="true" />
      <slot v-else />
      <AreaProgressDot :progress="progress" :label="label" />
      <!-- The unread dot sits on the icon's corner, where the progress dot sits,
           rather than on the item's: frappe-ui places its own at the item's. Red asks for the
           reader; gray says there is something, and none of it is theirs alone. -->
      <span
        v-if="unreadDot"
        data-icon-dot
        aria-hidden="true"
        :data-quiet="badgeQuiet || undefined"
        :class="[ICON_DOT, badgeQuiet ? 'bg-surface-gray-6' : 'bg-surface-red-6']"
      />
      <span v-if="hasBadgeSlot" class="absolute -right-2.5 -top-2.5">
        <slot name="badge" />
      </span>
    </span>
  </FrappeRailItem>
</template>

<script setup lang="ts">
import { SidebarRailItem as FrappeRailItem } from 'frappe-ui'
import { computed, useSlots, type Component } from 'vue'
import { useRoute, type RouteLocationRaw } from 'vue-router'

import { progressDetail, type AreaProgress } from '@/shell/areaProgress'
import AreaProgressDot from '@/shell/AreaProgressDot.vue'
import { ICON_DOT, ICON_DOT_HOST } from '@/shell/iconDot'

const props = withDefaults(
  defineProps<{
    label: string
    description?: string
    icon?: Component
    to?: RouteLocationRaw
    area?: string
    active?: boolean
    badge?: number
    badgeStyle?: 'count' | 'dot'
    /** The dot is gray rather than red: what it counts is not the reader's alone. */
    badgeQuiet?: boolean
    /** Where the dot's count is, one tooltip line each: "suite@example.com · 4 unread". */
    badgeParts?: readonly { label: string; count: number }[]
    variant?: 'subtle' | 'ghost'
    /** Background work of this item's area, drawn as a dot on the icon. */
    progress?: AreaProgress | null
    /** What the dot counts, in its tooltip: "3 unread", "2 upcoming". */
    badgeNoun?: string
  }>(),
  {
    active: undefined,
    badge: 0,
    badgeStyle: 'count',
    badgeQuiet: false,
    variant: 'ghost',
    progress: null,
  },
)

defineEmits<{ click: [event: MouseEvent] }>()

const route = useRoute()
const slots = useSlots()
const hasBadgeSlot = computed(() => Boolean(slots.badge))
const progressDescription = computed(() => progressDetail(props.progress))
// A dot drawn here rather than by frappe-ui, so the count it hides is spelled out in the tooltip
// as frappe-ui does for its own. Progress takes the corner when there is some.
const unreadDot = computed(() => props.badgeStyle === 'dot' && props.badge > 0 && !props.progress)
const counted = (count: number) => `${count} ${props.badgeNoun ?? __('unread')}`
// Spread over several places (Mail's accounts), it names each with its count, one to a line: the
// tooltip's second line keeps line breaks (see index.css).
const unreadDescription = computed(() => {
  if (!unreadDot.value) return undefined
  if (props.badgeParts?.length)
    return props.badgeParts.map((part) => `${part.label} · ${counted(part.count)}`).join('\n')
  return counted(props.badge)
})
// The item is active on every route its area's route group holds, also on a
// child that clears `area` to skip the capability gate (Mail's admin dashboard).
const resolvedActive = computed(
  () =>
    props.active ??
    (props.area ? route.matched.some((record) => record.meta.area === props.area) : false),
)
</script>
