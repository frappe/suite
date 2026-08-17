<template>
	<Dropdown v-if="!isMobile" :options="options" v-bind="$attrs">
		<slot />
	</Dropdown>
	<template v-else>
		<!-- inline-flex (not `contents`): display:contents elements ignore margins,
		     which broke parents' space-x-* spacing between triggers. Skipped entirely
		     for trigger-less (v-model:open only) usage — even an empty span adds a
		     line box to the parent. -->
		<span v-if="$slots.default" class="inline-flex" @click="open = true"><slot /></span>
		<BottomSheet v-model:open="open" :title="title">
			<div class="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
				<template v-for="(group, gi) in groups" :key="gi">
					<!-- Mirror the desktop Dropdown's separators between label-less groups. -->
					<div v-if="gi && !group.label" class="mx-3 my-2 border-t" />
					<div v-if="group.label" class="text-ink-gray-5 px-3 pb-1 pt-3 text-sm">
						{{ group.label }}
					</div>
					<button
						v-for="item in group.items"
						:key="item.label"
						class="active:bg-surface-gray-1 flex w-full items-center gap-3 rounded-6 px-3 py-2.5 text-base"
						:class="item.theme === 'red' ? 'text-ink-red-6' : 'text-ink-gray-8'"
						@click="run(item)"
					>
						<component
							:is="iconOf(item.icon)"
							v-if="item.icon"
							class="h-4 w-4 shrink-0"
							:class="item.theme === 'red' ? 'text-ink-red-6' : 'text-ink-gray-6'"
						/>
						<span class="flex-1 truncate text-left">{{ sheetLabel(item.label) }}</span>
						<!-- Which one you're already on. Desktop takes this from the Menu's own
						     selected styling; a sheet row has no such state, so it shows a tick. -->
						<Check v-if="item.selected" class="text-ink-gray-6 h-4 w-4 shrink-0" />
					</button>
				</template>
			</div>
		</BottomSheet>
	</template>
</template>

<script setup lang="ts">
import { computed, h, isVNode, type Component, type VNode } from 'vue'
import { Check } from 'lucide-vue-next'
import { BottomSheet, Dropdown } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { stripShortcutHint } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'

// Drop-in Dropdown replacement: desktop renders a frappe-ui Dropdown untouched,
// mobile renders the same options as a bottom sheet (popup menus at the bottom
// edge are thumb-hostile). Supports flat and grouped option arrays.

interface OptionItem {
	label: string
	icon?: string | Component | VNode
	onClick?: () => void
	condition?: () => boolean
	/**
	 * The option currently in effect. Same field frappe-ui's Menu reads on desktop (it
	 * coerces with `Boolean()`, so this must stay a plain boolean — pass a computed
	 * options array rather than a getter here).
	 */
	selected?: boolean
	theme?: string
}

type Options = (OptionItem | { group: string; options: OptionItem[] })[]

defineOptions({ inheritAttrs: false })

const { options, title } = defineProps<{
	options: Options
	title?: string
}>()

const { isMobile } = useScreenSize()
// Optional v-model:open for programmatic opening (e.g. chained from another
// sheet); works standalone via defineModel's local fallback otherwise.
const open = defineModel<boolean>('open', { default: false })

const visible = (items: OptionItem[]) =>
	items.filter((item) => (item.condition ? item.condition() : true))

const groups = computed(() => {
	const flat: OptionItem[] = []
	const grouped: { label: string; items: OptionItem[] }[] = []
	for (const entry of options ?? []) {
		if (entry && 'options' in entry) {
			const items = visible(entry.options ?? [])
			if (items.length) grouped.push({ label: entry.group, items })
		} else if (entry) {
			flat.push(entry as OptionItem)
		}
	}
	const flatVisible = visible(flat)
	return [...(flatVisible.length ? [{ label: '', items: flatVisible }] : []), ...grouped]
})

// Dropdown option icons come in three shapes across the app: a feather name
// string, a component, or a prebuilt vnode (h(Icon, ...)). Normalize all three
// into something <component :is> accepts.
const iconOf = (icon: OptionItem['icon']) => {
	if (typeof icon === 'string') return h(FeatherIcon, { name: icon })
	if (isVNode(icon)) return () => icon
	return icon
}

const run = (item: OptionItem) => {
	open.value = false
	item.onClick?.()
}

const sheetLabel = stripShortcutHint
</script>
