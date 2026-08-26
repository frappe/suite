<template>
	<div
		class="relative z-10 grid h-12 shrink-0 items-center justify-between border-b border-outline-elevation-1 bg-surface-elevation-1 px-3"
		:class="$slots.default ? 'grid-cols-3' : 'grid-cols-2'"
		@wheel.prevent
	>
		<div class="flex w-fit items-center gap-2">
			<router-link
				v-if="!dropdown"
				class="flex w-fit items-center gap-2"
				:to="{ name: 'slides-home' }"
			>
				<img :src="slidesLogo" class="h-7" />
			</router-link>

			<Dropdown
				v-else
				:options="dropdown === 'home' ? getHomeMenuOptions() : getContextMenuOptions()"
				:offset="16"
			>
				<template #default="{ open }">
					<div class="flex w-fit cursor-pointer items-center gap-2">
						<img :src="slidesLogo" class="h-7" />
						<LucideChevronUp v-if="open" class="w-4 stroke-[1.5] text-ink-gray-7" />
						<LucideChevronDown v-else class="w-4 stroke-[1.5] text-ink-gray-7" />
					</div>
				</template>
			</Dropdown>

			<slot name="left-actions"></slot>
		</div>

		<slot></slot>

		<div class="flex items-center justify-end gap-2">
			<slot name="right-actions"></slot>
			<Button
				v-if="!primaryButton.hide"
				variant="solid"
				:iconLeft="primaryButton.icon"
				:label="primaryButton.label"
				@click="primaryButton.onClick"
			/>
		</div>
	</div>
</template>

<script setup>
import { ref, inject } from 'vue'
import { useRouter } from 'vue-router'
import { Dropdown, Button } from 'frappe-ui'
import slidesLogo from '@/apps/slides/assets/slides-logo.svg'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import { showShortcutsModal } from '@/apps/slides/composables/useShortcuts'
import { useThemeMenuOption } from '@/composables/useThemeMenuOption'
import { useSessionStore } from '@/boot/session'

const props = defineProps({
	dropdown: {
		type: String,
		default: null,
	},
	primaryButton: Object,
})

const emit = defineEmits(['performDropdownAction'])

const router = useRouter()

const inReadonlyMode = inject('inReadonlyMode', ref(false))

const sessionStore = useSessionStore()

const appsMenuOption = useAppSwitcher('slides')

const themeMenuOption = useThemeMenuOption()

const getLogoutMenuOption = () => ({
	label: 'Log out',
	icon: 'lucide-log-out',
	onClick: () => sessionStore.logout.submit(),
})

const getHomeMenuOptions = () => [
	{ group: '', options: [appsMenuOption.value] },
	{ group: '', options: [themeMenuOption, getLogoutMenuOption()] },
]

const presentationActions = [
	{ label: 'New', icon: 'lucide-plus', action: 'create' },
	{ label: 'Duplicate', icon: 'lucide-copy', action: 'duplicate' },
	{ label: 'Delete', icon: 'lucide-trash', action: 'delete' },
	{ label: 'Change Theme', icon: 'lucide-swatch-book', action: 'updateTheme' },
]

const getContextMenuOptions = () => {
	const groups = []

	if (sessionStore.isLoggedIn) {
		groups.push({
			group: '',
			options: [
				{
					label: 'Back to Home',
					icon: 'lucide-arrow-left',
					onClick: () => router.replace({ name: 'slides-home' }),
				},
				appsMenuOption.value,
			],
		})
	}

	if (!inReadonlyMode.value) {
		groups.push({
			group: 'Presentation',
			options: presentationActions.map(({ label, icon, action }) => ({
				label,
				icon,
				onClick: () => emit('performDropdownAction', action),
			})),
		})
	}

	groups.push({
		group: '',
		options: [
			{
				label: 'Shortcuts',
				icon: 'lucide-command',
				onClick: () => (showShortcutsModal.value = true),
			},
			themeMenuOption,
			...(sessionStore.isLoggedIn ? [getLogoutMenuOption()] : []),
		],
	})

	return groups
}
</script>
