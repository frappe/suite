<template>
	<component
		:is="to ? RouterLink : 'div'"
		:to="to"
		class="sm:hover:bg-surface-gray-1 group flex cursor-default select-none space-x-2.5 border-b px-3.5 py-2.5 [-webkit-touch-callout:none] sm:space-x-5 sm:px-5"
		:class="{ '!bg-surface-blue-1': isSelected || isTouching, '!py-2': isFullWidth }"
		@mouseenter="isHovered = true"
		@mouseleave="isHovered = false"
		@touchstart="onTouchStart"
		@touchend="clearTouchTimer"
		@touchcancel="clearTouchTimer"
		@contextmenu="onContextMenu"
		@click.capture="onRowClick"
	>
		<!-- Selection column: checkbox on desktop, sender avatar on mobile or where the list has no
		     bulk selection. Long-pressing the row anywhere selects it on touch. -->
		<!-- max-sm:justify-start pins the avatar/checkbox to the row's 14px padding
		     axis; centered, the 40px column left them 2-4px "inside" it. -->
		<div
			class="flex shrink-0 items-center justify-center max-sm:w-10 max-sm:justify-start"
			:class="isFullWidth ? 'h-8' : 'h-10 sm:-mt-1.5'"
		>
			<div
				v-if="!isMobile && selectable"
				class="checkbox-hitbox -m-3 cursor-pointer p-3"
				@click.stop.prevent="emit('setSelected', !isSelected)"
			>
				<Checkbox :model-value="isSelected" size="md" class="pointer-events-none" />
			</div>
			<div
				v-else-if="isSelected"
				class="bg-surface-gray-10 hitbox flex h-8 w-8 shrink-0 rounded-full max-sm:h-10 max-sm:w-10"
				@click.stop.prevent="emit('setSelected', false)"
			>
				<Check class="text-ink-base m-auto h-5 w-5 stroke-[4px]" />
			</div>
			<Avatar
				v-show="!isSelected && (isMobile || !selectable)"
				:label="avatarLabel"
				:image="avatarImage"
				size="xl"
				class="hitbox max-sm:!h-10 max-sm:!w-10"
				@click.stop.prevent="emit('setSelected', true)"
			/>
		</div>

		<div class="grow truncate" :class="isFullWidth ? 'flex items-center space-x-3' : 'space-y-1'">
			<div
				v-if="showSender"
				class="flex items-center"
				:class="isFullWidth ? 'w-48 shrink-0' : 'justify-between'"
			>
				<div class="mr-2 mt-0.5 flex items-center space-x-1.5 truncate">
					<span v-if="unread" class="min-h-2 min-w-2 rounded-full bg-blue-500" />
					<h3
						class="truncate text-[15px] !font-medium sm:text-base"
						:class="{ '!font-semibold': unread }"
					>
						<slot name="sender" />
					</h3>
					<slot name="badges" />
				</div>
				<MailDate v-if="!isFullWidth" :datetime :in-list="true" />
			</div>

			<h4
				class="truncate text-sm !leading-[1.5]"
				:class="{ italic: subjectItalic, '!text-base': isFullWidth, '!font-semibold': unread }"
			>
				<!-- Wherever the sender line is dropped, the dot it normally sits on comes down here. -->
				<span
					v-if="unread && !showSender"
					class="bg-blue-500 mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
				/>
				<slot name="subject" />
			</h4>

			<div
				class="flex items-center justify-between truncate"
				:class="{ 'min-w-0 flex-1 !text-base': isFullWidth }"
			>
				<h5
					class="text-ink-gray-5 truncate text-sm !leading-[1.5]"
					:class="{ italic: previewItalic, '!text-base': isFullWidth }"
				>
					<slot name="preview" />
				</h5>

				<div v-if="!isFullWidth" class="ml-3.5 flex space-x-3.5">
					<slot name="trailing" :is-hovered="isHovered" />
				</div>
			</div>

			<slot name="extra" :is-full-width="isFullWidth" />
		</div>

		<div v-if="isFullWidth" class="flex w-32 shrink-0 items-center justify-end space-x-4">
			<MailDate v-if="!isHovered" :datetime :in-list="true" />
			<slot name="trailing" :is-hovered="isHovered" />
		</div>

		<slot />
	</component>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import { Check } from 'lucide-vue-next'
import { Avatar, Checkbox } from 'frappe-ui'

import { useScreenSize } from '@/apps/mail/utils/composables'
import MailDate from '@/apps/mail/components/MailDate.vue'

import type { UserResource } from '@/apps/mail/types'

// The shared skeleton of a row in the mail list: selection column, sender line with its date, subject,
// preview, and the trailing slot the star or chevron sits in. It owns the layout and nothing else —
// what goes in each slot is the caller's business.
//
// It exists because MailListItem and StackListItem must line up pixel-for-pixel while being different
// things (one is a link to a thread, the other a collapsed run of them). Holding the class strings in
// one place is what keeps them from drifting apart, which is exactly what happened when they didn't.
const {
	to,
	isSelected,
	selectable = true,
	unread = false,
	hideSender = false,
	avatarLabel,
	avatarImage,
	datetime,
	subjectItalic = false,
	previewItalic = false,
	selectionMode = false,
	noReadingPane = false,
} = defineProps<{
	// Renders the row as a link when set, and as a plain div when not — a thread opens, a stack expands.
	to?: RouteLocationRaw
	isSelected: boolean
	// When false the desktop checkbox gives way to the sender avatar (lists without bulk selection).
	selectable?: boolean
	// Drives the blue dot and the bolding of the sender and subject.
	unread?: boolean
	// Set on the members of an expanded stack: the stack row above them already names the sender, so
	// repeating it on every row is noise.
	hideSender?: boolean
	avatarLabel: string
	avatarImage?: string
	datetime: string
	subjectItalic?: boolean
	previewItalic?: boolean
	// Mobile selection mode (a selection exists): rows swap avatars for checkboxes,
	// hide trailing actions, and a tap toggles selection instead of navigating.
	selectionMode?: boolean
	// Set by views that render no reading pane (All Inboxes): the reading-pane setting can't cost
	// them any width, so their rows always take the full-width layout on desktop.
	noReadingPane?: boolean
}>()

const emit = defineEmits<{ setSelected: [selected: boolean] }>()

const user = inject('$user') as UserResource
const { isMobile } = useScreenSize()

const isHovered = ref(false)

// In selection mode a row tap toggles membership; capture-phase so the
// RouterLink navigation never fires. Real buttons inside the row (the trailing
// star) are exempt and keep their own action.
const onRowClick = (e: MouseEvent) => {
	if (!selectionMode) return
	if ((e.target as HTMLElement).closest('button')) return
	e.preventDefault()
	e.stopPropagation()
	emit('setSelected', !isSelected)
}

// With the reading pane hidden — by the setting, or because the enclosing view has none — the list
// has the window to itself, so a row lays out as one wide line instead of a stacked block.
const isFullWidth = computed(
	() => !isMobile.value && (noReadingPane || !user.data.show_reading_pane),
)

// A stack member's sender is worth dropping only in the stacked layout, where the sender owns a whole
// line and repeating the same name down a run costs a third of every row's height. Full-width keeps it:
// there the sender is a column, where a repeated value is cheap to skip past, and dropping it would
// leave each member's subject a different width — sending the preview column ragged and pulling the
// members out of line with the stack row above them.
const showSender = computed(() => !hideSender || isFullWidth.value)

// Touch selection: a long press anywhere on the row selects it, as long as the finger stays put (a
// drag is a scroll, not a press).
let touchStartX = 0
let touchStartY = 0
let touchMoved = false
let touchTimer: ReturnType<typeof setTimeout> | null = null

const isTouching = ref(false)

const onTouchStart = (e: TouchEvent) => {
	touchMoved = false
	touchStartX = e.touches[0].clientX
	touchStartY = e.touches[0].clientY
	isTouching.value = true
	document.addEventListener('touchmove', onTouchMove, { passive: true })

	touchTimer = setTimeout(() => {
		if (!touchMoved) emit('setSelected', !isSelected)
	}, 450)
}

const clearTouchTimer = () => {
	isTouching.value = false
	document.removeEventListener('touchmove', onTouchMove)

	if (touchTimer) {
		clearTimeout(touchTimer)
		touchTimer = null
	}
}

// The row is an anchor, so a long press also summons the browser's link menu on top of the
// selection the row already handles. Suppress it for touch presses only — a desktop right-click
// keeps its menu. (iOS shows a callout instead of firing contextmenu; -webkit-touch-callout on
// the row covers that.)
const onContextMenu = (e: Event) => {
	if (isTouching.value) e.preventDefault()
}

const onTouchMove = (e: TouchEvent) => {
	const touch = e.touches[0]
	const dx = Math.abs(touch.clientX - touchStartX)
	const dy = Math.abs(touch.clientY - touchStartY)
	if (dx > 10 || dy > 10) {
		touchMoved = true
		clearTouchTimer()
	}
}
</script>

<style scoped>
.hitbox {
	@apply relative after:absolute after:-inset-2 after:content-[''];
}

.checkbox-hitbox:hover :deep(input[type='checkbox']) {
	@apply shadow-sm;
	border-color: var(--outline-gray-7);
}
</style>
