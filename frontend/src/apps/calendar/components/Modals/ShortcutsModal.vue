<template>
	<!-- `size` falls through to the Dialog inside: the default 5xl is sized for three columns. -->
	<KeyboardShortcutsDialog v-model:open="open" :title="__('Keyboard Shortcuts')" size="3xl">
		<template #default="{ groups }">
			<!-- Two columns, Calendar then Other: the default grid runs to three and orders
			     groups by who registered first. -->
			<div class="grid max-h-[70vh] grid-cols-1 gap-8 gap-x-6 overflow-y-auto pr-1 md:grid-cols-2">
				<div v-for="group in ordered(groups)" :key="group.name" class="space-y-1">
					<h3 class="mb-3 text-base-medium tracking-wide text-ink-gray-8">{{ group.name }}</h3>
					<div
						v-for="shortcut in group.shortcuts"
						:key="shortcut.description"
						class="grid grid-cols-[1fr_auto] items-start gap-3 rounded-4 py-0.5"
					>
						<span class="text-p-base text-ink-gray-6">{{ shortcut.description }}</span>
						<KeyboardShortcut :combo="shortcut.combo" :alt-combos="shortcut.altCombos" bg />
					</div>
				</div>
			</div>
		</template>
	</KeyboardShortcutsDialog>
</template>

<script setup lang="ts">
import { KeyboardShortcut, KeyboardShortcutsDialog } from 'frappe-ui'

type Group = { name: string; shortcuts: any[] }

const open = defineModel<boolean>('open', { default: false })

// frappe-ui's settings dialog files its shortcut under General, a name the app can't change,
// so that group is folded into the app's own Other.
const ordered = (groups: Group[]) => {
	const other = __('Other')
	const merged = new Map<string, Group>()
	for (const group of groups) {
		const name = group.name === 'General' ? other : group.name
		const into = merged.get(name) ?? { name, shortcuts: [] }
		into.shortcuts.push(...group.shortcuts)
		merged.set(name, into)
	}
	return [...merged.values()].sort((a, b) => Number(a.name === other) - Number(b.name === other))
}
</script>
