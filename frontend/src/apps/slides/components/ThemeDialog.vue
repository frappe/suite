<template>
	<Dialog
		v-model:open="showThemeDialog"
		size="2xl"
		:title="dialogTitle"
		:dismissible="update"
		:showCloseButton="update"
	>
		<div class="flex flex-col gap-5">
			<p class="text-p-base text-ink-gray-7">{{ dialogDescription }}</p>
			<div class="-m-1 no-scrollbar grid max-h-[32rem] grid-cols-2 gap-6 overflow-y-auto p-1">
				<div
					v-for="(theme, idx) in templateList"
					:key="theme.name"
					class="flex flex-col gap-3"
				>
					<div
						class="aspect-video cursor-pointer overflow-hidden rounded-6 border border-outline-gray-1 hover:border-outline-gray-2"
						:class="getThemeThumbnailClasses(theme.name)"
						:style="getThemeThumbnailStyles(theme)"
						@click="performAction(theme.name)"
					>
						<SlidePreview
							v-if="shouldRenderPreview(theme)"
							:slide="getThemePreviewLayout(theme)"
							:scale="THEME_PREVIEW_SCALE"
						/>
					</div>
					<div class="flex items-center justify-between">
						<div class="select-none text-base text-ink-gray-7">
							{{ theme.title }}
						</div>
						<LucideCheck
							v-if="props.update && theme.name == presentationTheme"
							class="size-4 stroke-[1.5] text-ink-gray-8"
						/>
					</div>
				</div>
			</div>
		</div>
	</Dialog>
</template>

<script setup>
import { computed } from 'vue'
import { Dialog } from 'frappe-ui'

import SlidePreview from '@/apps/slides/components/SlidePreview.vue'
import { getThumbnailCardStyles } from '@/apps/slides/utils/helpers'
import { presentationTheme, templateList } from '@/apps/slides/stores/presentation'

// card width: 2xl dialog (672) - px-6 (48) - gap-6 (24), halved
const THEME_PREVIEW_SCALE = 300 / 960

const props = defineProps({
	update: {
		type: Boolean,
		default: false,
	},
})

const showThemeDialog = defineModel('open', { required: true })

const emit = defineEmits(['create'])

const dialogTitle = computed(() => (props.update ? 'Set theme' : 'Select theme'))
const dialogDescription = computed(() =>
	props.update
		? 'Update the theme for this presentation. All newly added slides will use this theme.'
		: 'Select a theme for your new presentation. You can change this theme later.',
)

const performAction = (theme) => {
	if (props.update) {
		emit('update', theme)
	} else {
		emit('create', theme)
	}
}

const getThemeThumbnailClasses = (theme) => {
	return props.update && theme == presentationTheme.value
		? 'ring-2 ring-offset-1 ring-outline-gray-2'
		: ''
}

const getThemePreviewLayout = (theme) => {
	const thumbnailIdx = ['Light', 'Dark'].includes(theme.title) ? 2 : 0
	return theme.layouts[thumbnailIdx] || theme.layouts[0]
}

const getThemeThumbnailStyles = (theme) => {
	const layout = getThemePreviewLayout(theme)
	return {
		...getThumbnailCardStyles(layout?.thumbnail),
		'--tw-ring-offset-color': 'var(--surface-base)',
	}
}

const shouldRenderPreview = (theme) => {
	const layout = getThemePreviewLayout(theme)
	return layout && !layout.thumbnail
}
</script>
