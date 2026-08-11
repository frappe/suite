<template>
	<div
		class="isolate flex h-screen w-screen select-none flex-col overflow-hidden"
		@click="focusedSlide = null"
	>
		<EditorNavbar
			@startSlideShow="startSlideShow"
			@performDropdownAction="performNavbarDropdownAction"
		/>

		<div class="relative flex h-screen bg-surface-gray-1">
			<SlideContainer
				ref="slideContainer"
				v-if="presentationDoc"
				v-model:hasOngoingInteraction="isSlideInteractionActive"
			/>

			<NavigationPanel class="absolute bottom-0 top-0" @changeSlide="changeEditorSlide" />

			<Toolbar v-if="!inReadonlyMode && presentationDoc" />

			<PropertiesPanel v-if="!inReadonlyMode" class="absolute bottom-0 right-0 top-0" />
		</div>
	</div>

	<LayoutDialog
		v-model="showLayoutDialog"
		@insert="(layoutObj) => handleInsertSlide(insertIndex, layoutObj)"
	/>

	<ThemeDialog
		v-model="showThemeDialog"
		@create="(theme) => createPresentation(theme)"
		@update="(theme) => updatePresentationTheme(theme)"
		:update="themeDialogAction == 'update'"
	/>

	<Dialog v-model="showDeleteDialog" class="pb-0" size="sm">
		<template #title>
			<div class="font-semibold">Delete Presentation</div>
		</template>
		<template #default>
			<div class="text-base">
				This action will permanently delete
				<strong>{{ presentationDoc?.title }}</strong
				>. Are you sure you want to continue?
			</div>
		</template>
		<template #actions>
			<Button
				class="w-full"
				variant="solid"
				theme="red"
				label="Delete Presentation"
				@click="confirmDelete"
			>
				<template #prefix>
					<Trash size="14" class="stroke-[1.5]" />
				</template>
			</Button>
		</template>
	</Dialog>

	<teleport to="body">
		<ExportView v-if="showExportView" :slides="slides" />
	</teleport>

	<ThumbnailCapture
		ref="thumbnailCaptureRef"
		v-if="presentationDoc && !inReadonlyMode && slides.length"
		:slide="slides[0]"
		:disableCapture="isSlideInteractionActive"
	/>

	<KeyboardShortcutsModal v-model:open="showShortcutsModal" />
</template>

<script setup>
import {
	ref,
	watch,
	onMounted,
	onBeforeUnmount,
	provide,
	nextTick,
	useTemplateRef,
} from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'

import { call, toast, usePageMeta, KeyboardShortcutsModal, Dialog, Button } from 'frappe-ui'

import ExportView from '@/apps/slides/pages/ExportView.vue'
import EditorNavbar from '@/apps/slides/components/EditorNavbar.vue'
import NavigationPanel from '@/apps/slides/components/NavigationPanel.vue'
import PropertiesPanel from '@/apps/slides/components/PropertiesPanel.vue'

import SlideContainer from '@/apps/slides/components/SlideContainer.vue'
import Toolbar from '@/apps/slides/components/Toolbar.vue'
import ThemeDialog from '@/apps/slides/components/ThemeDialog.vue'
import LayoutDialog from '@/apps/slides/components/LayoutDialog.vue'
import ThumbnailCapture from '@/apps/slides/components/ThumbnailCapture.vue'

import {
	presentationId,
	initPresentationDoc,
	presentationDoc,
	templateList,
	templateListResource,
	inReadonlyMode,
	createPresentationResource,
	duplicatePresentation,
	deletePresentation,
	presentationTheme,
	resetEditorState,
} from '@/apps/slides/stores/presentation'
import {
	slides,
	slideIndex,
	selectionBounds,
	focusedSlide,
	setSlideIndex,
	changeEditorSlide,
	addEmptySlide,
	handleInsertSlide,
} from '@/apps/slides/stores/slide'
import { resetFocus, focusElementId } from '@/apps/slides/stores/element'
import {
	commandHistory,
	setCommandHistory,
	actions as historyMetaActions,
	actionOrder as historyMetaActionOrder,
} from '@/apps/slides/stores/historyMeta'

import { useShortcuts, showShortcutsModal } from '@/apps/slides/composables/useShortcuts'
import { saveChanges, saveCurrentState, dirty } from '@/apps/slides/stores/saving'
import { inSlideShowMode, startSlideShow } from '@/apps/slides/stores/slideshow'
import { Layout, Trash } from 'lucide-vue-next'
import { useCommandHistory } from '@/apps/slides/composables/useCommandHistory'


const route = useRoute()
const router = useRouter()

let autosaveInterval = null
const thumbnailCaptureRef = useTemplateRef('thumbnailCaptureRef')

const props = defineProps({
	presentationId: String,
	slug: String,
	activeSlideId: {
		type: Number,
		required: true,
	},
	editorAccess: {
		type: String,
		default: 'none',
	},
})

const showThemeDialog = ref(false)
const themeDialogAction = ref('update')
const isSlideInteractionActive = ref(false)

const showLayoutDialog = ref(false)
const insertIndex = ref(null)
const showExportView = ref(false)
const showDeleteDialog = ref(false)

const historyMetaForCommandHistory = {
	actions: historyMetaActions,
	actionOrder: historyMetaActionOrder,
}
const commandHistoryInstance = useCommandHistory(slides, historyMetaForCommandHistory)
setCommandHistory(commandHistoryInstance)

useShortcuts(inReadonlyMode, inSlideShowMode)

usePageMeta(() => {
	return {
		title: presentationDoc.value?.title || 'Slides',
	}
})

const handleAutoSave = () => {
	if (isSlideInteractionActive.value || focusElementId.value != null) return
	saveChanges()
}

const updateRoute = async (slug) => {
	if (props.slug == slug) return
	router.replace({
		name: 'slides-editor',
		params: { presentationId: presentationId.value, slug: slug },
		query: { slide: slideIndex.value + 1 },
	})
}

const initAutoSave = () => {
	autosaveInterval = setInterval(handleAutoSave, 500)
}

const loadPresentation = async (id) => {
	presentationDoc.value = await initPresentationDoc(id, inReadonlyMode.value)
}

const handleBeforeUnload = (e) => {
	if (dirty.value) {
		e.preventDefault()
		e.returnValue = ''
	}
}

const loadTemplates = () => {
	if (templateList.value.length || inReadonlyMode.value) return
	templateListResource.fetch()
}

const performBeforeLoadOperations = () => {
	if (inReadonlyMode.value) return

	window.addEventListener('beforeunload', handleBeforeUnload)
}

const performAfterLoadOperations = () => {
	setSlideIndex(props.activeSlideId)
	updateRoute(presentationDoc.value.slug)

	if (inReadonlyMode.value) return

	initAutoSave()
}

const loadEditorState = async () => {
	const id = props.presentationId
	if (!id) return

	performBeforeLoadOperations()
	if (presentationDoc.value && presentationId.value === id && slides.value.length) {
		performAfterLoadOperations()
		return
	}

	await loadPresentation(id)
	performAfterLoadOperations()
}

const handleMounted = () => {
	// templates load from Home.vue
	// but if user lands directly on editor check and load them
	loadTemplates()
}

const hideOpenDialogs = () => {
	showThemeDialog.value = false
	showLayoutDialog.value = false
}

const handleBeforeUnmount = () => {
	thumbnailCaptureRef.value?.reset()
	clearInterval(autosaveInterval)

	if (router.currentRoute.value.name !== 'slides-slideshow') {
		resetFocus()
		saveCurrentState()
	}
	window.removeEventListener('beforeunload', handleBeforeUnload)
	window.removeEventListener('popstate', hideOpenDialogs)
}

watch(
	() => props.activeSlideId,
	(index) => {
		if (!slides.value.length) return
		setSlideIndex(index)
	},
	{ immediate: true },
)

watch(
	() => route.name,
	(name) => {
		if (!['slides-editor-new', 'slides-editor'].includes(name)) return
		inReadonlyMode.value = props.editorAccess == 'view'
		if (name === 'slides-editor-new') {
			resetEditorState()
			themeDialogAction.value = 'create'
			showThemeDialog.value = true
			return
		}
		loadEditorState()
	},
	{ immediate: true },
)

watch(
	() => props.presentationId,
	(id, prevId) => {
		if (!id || !prevId || id === prevId) return
		inReadonlyMode.value = props.editorAccess == 'view'
		thumbnailCaptureRef.value?.reset()
		commandHistory.clearHistory()
		loadEditorState()
	},
)

onBeforeRouteLeave(() => {
	hideOpenDialogs()
})

window.addEventListener('popstate', hideOpenDialogs)

watch(
	() => props.editorAccess,
	(doc) => {
		inReadonlyMode.value = doc === 'view'
	},
)

onMounted(() => handleMounted())

onBeforeUnmount(() => handleBeforeUnmount())

provide('inReadonlyMode', inReadonlyMode)
provide('inSlideShowMode', inSlideShowMode)

const navigateToPresentation = async (name) => {
	if (route.name === 'slides-editor-new') {
		await router.replace({
			name: 'slides-editor',
			params: { presentationId: name },
			query: { slide: 1 },
		})
	} else {
		await router.push({
			name: 'slides-editor',
			params: { presentationId: name },
			query: { slide: 1 },
		})
	}
}

const createPresentation = async (theme) => {
	showThemeDialog.value = false
	const newPresentation = await createPresentationResource.submit({
		template: theme,
		parent: route.query.parent || '',
	})
	const name = newPresentation?.name

	if (!name) {
		console.error('Failed to create new presentation')
		return
	}

	navigateToPresentation(name)
}

const updatePresentationTheme = async (theme) => {
	const id = presentationId.value
	if (!id) return

	showThemeDialog.value = false

	try {
		const doc = await call('frappe.client.set_value', {
			doctype: 'Presentation',
			name: id,
			fieldname: 'theme',
			value: theme,
		})

		// the editor can move on mid-request; writing then would apply the theme
		// and the modified stamp to a different presentation
		if (presentationDoc.value?.name !== id) return

		presentationDoc.value.theme = theme
		// autosave stamps this onto the local copy, so a stale value would make the
		// next load discard edits that had not synced yet
		presentationDoc.value.modified = doc.modified
	} catch (error) {
		console.error('Failed to update theme: ', error)
		toast.error('Could not update the theme. Please try again.')
	}
}

const performNavbarDropdownAction = async (action) => {
	if (action == 'create') {
		await router.push({ name: 'slides-editor-new' })
	} else if (action == 'duplicate') {
		const newPresentation = await duplicatePresentation(presentationId.value)
		navigateToPresentation(newPresentation)
	} else if (action == 'delete') {
		showDeleteDialog.value = true
	} else if (action == 'updateTheme') {
		themeDialogAction.value = 'update'
		showThemeDialog.value = true
	} else if (action == 'export') {
		exportPdf()
	}
}

const confirmDelete = async () => {
	showDeleteDialog.value = false
	await deletePresentation(presentationId.value)
	thumbnailCaptureRef.value?.reset()
	router.push({ name: 'slides-home' })
}

const openLayoutDialog = (index) => {
	showLayoutDialog.value = true
	insertIndex.value = index
}

provide('openLayoutDialog', openLayoutDialog)

const cleanup = () => {
	showExportView.value = false
	window.removeEventListener('afterprint', cleanup)
}

const exportPdf = () => {
	showExportView.value = true

	nextTick(() => {
		setTimeout(() => {
			window.addEventListener('afterprint', cleanup, { once: true })
			window.print()
		}, 200)
	})
}
</script>
