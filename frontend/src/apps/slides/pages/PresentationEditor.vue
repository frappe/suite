<template>
	<!-- clip, not just hidden: a hidden root still scrolls when a caret lands past its edge -->
	<div
		class="isolate flex h-screen w-screen select-none flex-col overflow-hidden overflow-clip"
		@click="focusedSlide = null"
	>
		<EditorNavbar
			@startSlideShow="startSlideShow"
			@performDropdownAction="performNavbarDropdownAction"
		/>

		<div class="relative flex h-screen bg-surface-gray-1 dark:bg-surface-base">
			<SlideContainer
				ref="slideContainer"
				v-if="presentationDoc"
				v-model:hasOngoingInteraction="isSlideInteractionActive"
			/>

			<NavigationPanel class="absolute bottom-0 top-0" @changeSlide="changeEditorSlide" />

			<Toolbar v-if="!inReadonlyMode && presentationDoc" />

			<div
				v-if="lockedElsewhere"
				class="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-4 bg-surface-elevation-1 p-0.5 shadow-md"
			>
				<div class="flex items-center gap-2 p-2">
					<LucideLock class="size-4 stroke-[1.5] text-ink-gray-7" />
					<span class="text-base text-ink-gray-7">Editing in another tab</span>
				</div>
				<div class="h-5 w-px bg-surface-gray-4" />
				<Button variant="ghost" @click="takeOverEditing">Edit here</Button>
			</div>

			<div
				v-if="saveRefused && !lockedElsewhere"
				class="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-4 bg-surface-elevation-1 p-0.5 shadow-md"
			>
				<div class="flex items-center gap-2 p-2">
					<LucideCloudOff class="size-4 stroke-[1.5] text-ink-gray-7" />
					<span class="text-base text-ink-gray-7">
						Changed elsewhere. Reloading discards your unsaved edits.
					</span>
				</div>
				<div class="h-5 w-px bg-surface-gray-4" />
				<Button variant="ghost" @click="reloadPresentation()">Reload</Button>
			</div>

			<PropertiesPanel v-if="!inReadonlyMode" class="absolute bottom-0 right-0 top-0" />
		</div>
	</div>

	<LayoutDialog
		v-model:open="showLayoutDialog"
		@insert="(layoutObj) => handleInsertSlide(insertIndex, layoutObj)"
	/>

	<ThemeDialog
		v-model:open="showThemeDialog"
		@create="(theme) => createPresentation(theme)"
		@update="(theme) => updatePresentationTheme(theme)"
		:update="themeDialogAction == 'update'"
	/>

	<teleport to="body">
		<ExportView v-if="showExportView" :slides="slides" />
	</teleport>

	<ThumbnailCapture
		ref="thumbnailCaptureRef"
		v-if="presentationDoc && !inReadonlyMode && slides.length"
		:slide="slides[0]"
		:disableCapture="isSlideInteractionActive"
	/>

	<KeyboardShortcutsDialog v-model:open="showShortcutsModal" />
</template>

<script setup>
import {
	ref,
	watch,
	onMounted,
	onActivated,
	onDeactivated,
	onBeforeUnmount,
	onScopeDispose,
	provide,
	nextTick,
	useTemplateRef,
} from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

import { call, toast, usePageMeta, Button, KeyboardShortcutsDialog } from 'frappe-ui'
import { appPageMeta } from '@/utils/documentTitle'
import { useRootStore } from '@/stores/root'
import { confirmLeave } from '@/utils/confirmLeave'

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
	startLoad,
	isLatestLoad,
	presentationDoc,
	templateList,
	templateListResource,
	viewOnly,
	inReadonlyMode,
	createPresentationResource,
	duplicatePresentation,
	confirmDeletePresentation,
	presentationTheme,
	adoptServerVersion,
	resetEditorState,
	pageTitle,
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
import { resetFocus, flushPendingBlur } from '@/apps/slides/stores/element'
import {
	lockedElsewhere,
	holdsEditLock,
	acquireEditLock,
	releaseEditLock,
} from '@/apps/slides/stores/editLock'
import {
	commandHistory,
	setCommandHistory,
	actions as historyMetaActions,
	actionOrder as historyMetaActionOrder,
} from '@/apps/slides/stores/historyMeta'

import { useShortcuts, showShortcutsModal } from '@/apps/slides/composables/useShortcuts'
import { saveChanges, saveDraft, dirty, saveRefused } from '@/apps/slides/stores/saving'
import {
	refreshOfflineStatus,
	warmOfflineCopyAssets,
	pruneOfflineCopy,
} from '@/apps/slides/stores/offlineCopy'
import { inSlideShowMode, startSlideShow } from '@/apps/slides/stores/slideshow'
import { Layout } from 'lucide-vue-next'
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

const unregisterPaletteGroups = useRootStore().registerPaletteGroups(
	'slides-editor-settings',
	() => {
		if (
			route.name !== 'slides-editor' ||
			presentationDoc.value?.name !== props.presentationId ||
			inReadonlyMode.value
		)
			return []

		return [
			{
				commands: [
					{
						id: 'slides-settings',
						label: 'Change presentation theme',
						shortcut: 'Mod+Shift+Comma',
						icon: 'lucide-palette',
						keywords: ['slides', 'theme', 'appearance'],
						run: () => {
							themeDialogAction.value = 'update'
							showThemeDialog.value = true
						},
					},
				],
			},
		]
	},
)
onScopeDispose(unregisterPaletteGroups)

const showLayoutDialog = ref(false)
const insertIndex = ref(null)
const showExportView = ref(false)
let deleteDialog = null

const historyMetaForCommandHistory = {
	actions: historyMetaActions,
	actionOrder: historyMetaActionOrder,
}
const commandHistoryInstance = useCommandHistory(slides, historyMetaForCommandHistory)
setCommandHistory(commandHistoryInstance)

useShortcuts(inReadonlyMode, inSlideShowMode)

usePageMeta(() => {
	return appPageMeta(pageTitle(), 'Slides')
})

onActivated(() => (document.title = pageTitle()))

// a drag in progress would push every intermediate position
const handleAutoSave = () => {
	if (!isSlideInteractionActive.value) saveChanges()
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
	clearInterval(autosaveInterval)
	autosaveInterval = setInterval(handleAutoSave, 500)
}

const handleBeforeUnload = (e) => {
	// a tab that lost the lock has nothing left to save
	if (dirty.value && !inReadonlyMode.value) {
		e.preventDefault()
		e.returnValue = ''
	}
}

// best effort: the tab is going away, whatever the draft store manages to take goes in
const handlePageHide = () => {
	if (dirty.value) saveDraft()
}

const loadTemplates = () => {
	if (templateList.value.length || inReadonlyMode.value) return
	templateListResource.fetch()
}

const performBeforeLoadOperations = () => {
	if (inReadonlyMode.value) return

	window.addEventListener('beforeunload', handleBeforeUnload)
	window.addEventListener('pagehide', handlePageHide)
}

const performAfterLoadOperations = () => {
	setSlideIndex(props.activeSlideId)
	updateRoute(presentationDoc.value.slug)
	// once per open: an image deleted then undone must not cost the copy its bytes
	pruneOfflineCopy(presentationId.value).catch(() => {})

	if (inReadonlyMode.value) return

	initAutoSave()
}

const loadEditorState = async () => {
	const id = props.presentationId
	if (!id) return
	// re-entry from Home fires both the route and the props watcher; only the last load lands
	// read off the prop: the store flag follows one watcher later
	const readonly = props.editorAccess == 'view'
	// another tab may have saved while the lock was out of this tab's hands
	const current = readonly || holdsEditLock(id)
	// the copy on screen is behind then, and an edit made to it would go under the fresh one
	if (!current) resetEditorState()
	const load = startLoad()

	if (!readonly) {
		const held = await acquireEditLock(id, handleLockLost)
		if (!isLatestLoad(load)) return
		// refused with no other holder: the editor left while the request was pending
		if (!held && !lockedElsewhere.value) return
	}

	performBeforeLoadOperations()
	if (current && presentationDoc.value && presentationId.value === id && slides.value.length) {
		performAfterLoadOperations()
		return
	}

	const doc = await initPresentationDoc(id, readonly, load)
	if (!doc) return
	performAfterLoadOperations()
}

// the server copy replaces what is on screen; the lock stays with this tab
const reloadPresentation = async (load = startLoad()) => {
	performBeforeLoadOperations()
	const doc = await initPresentationDoc(props.presentationId, false, load)
	if (!doc) return
	commandHistory.clearHistory()
	performAfterLoadOperations()
}

const takeOverEditing = async () => {
	const load = startLoad()
	await acquireEditLock(props.presentationId, handleLockLost, { steal: true })
	if (!isLatestLoad(load)) return
	await reloadPresentation(load)
}

const handleMounted = () => {
	// templates load from Home.vue
	// but if user lands directly on editor check and load them
	loadTemplates()
}

const hideOpenDialogs = () => {
	showThemeDialog.value = false
	showLayoutDialog.value = false
	deleteDialog?.close()
}

// the open editor and the selection belong to the presentation being left
const leavePresentation = () => {
	flushPendingBlur()
	resetFocus()
	saveChanges()
	releaseEditLock()
	// a store left live would push from Home after giving up the lock
	resetEditorState()
}

// the taking tab pushes what it finds in the draft; a push from here would race it
const handleLockLost = () => {
	flushPendingBlur()
	resetFocus()
	saveDraft()
	clearInterval(autosaveInterval)
}

// an open text box would keep taking keystrokes the draft no longer sees
watch(saveRefused, (refused) => {
	if (!refused) return
	flushPendingBlur()
	resetFocus()
	clearInterval(autosaveInterval)
})

const handleDeactivated = () => {
	thumbnailCaptureRef.value?.reset()
	clearInterval(autosaveInterval)

	// the slideshow keeps the editor and its lock, so only the edits go out before it starts
	if (router.currentRoute.value.name === 'slides-slideshow') {
		flushPendingBlur()
		resetFocus()
		saveChanges()
	} else leavePresentation()
}

const handleBeforeUnmount = () => {
	handleDeactivated()
	window.removeEventListener('beforeunload', handleBeforeUnload)
	window.removeEventListener('pagehide', handlePageHide)
	window.removeEventListener('popstate', hideOpenDialogs)
}

// slides land after the load resolves; a save is when new media shows up in them
watch([slides, () => presentationDoc.value?.modified], () => {
	const id = slides.value.length ? presentationId.value : null
	refreshOfflineStatus(id)
	warmOfflineCopyAssets(id)
})

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

		if (name === 'slides-editor-new') {
			leavePresentation()
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
		leavePresentation()
		thumbnailCaptureRef.value?.reset()
		commandHistory.clearHistory()
		loadEditorState()
	},
)

const confirmUnsavedNavigation = async () => {
	hideOpenDialogs()
	if (!dirty.value || inReadonlyMode.value) return true
	return confirmLeave()
}
onBeforeRouteLeave(confirmUnsavedNavigation)
onBeforeRouteUpdate((to, from) => {
	if (to.params.presentationId === from.params.presentationId) return true
	return confirmUnsavedNavigation()
})

window.addEventListener('popstate', hideOpenDialogs)

// after the switch watcher, so the presentation being left is flushed while it may still write
watch(
	() => props.editorAccess,
	(access) => {
		viewOnly.value = access === 'view'
	},
	{ immediate: true },
)

onMounted(() => handleMounted())

onDeactivated(() => handleDeactivated())

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
		const doc = await call('suite.slides.doctype.presentation.presentation.update_theme', {
			name: id,
			theme: theme,
		})

		// the editor can move to another presentation mid-request
		if (presentationDoc.value?.name !== id) return

		presentationDoc.value.theme = theme
		await adoptServerVersion(id, doc)
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
		deleteDialog = confirmDeletePresentation(
			{ name: presentationId.value, title: presentationDoc.value?.title },
			() => {
				thumbnailCaptureRef.value?.reset()
				router.push({ name: 'slides-home' })
			},
		)
	} else if (action == 'updateTheme') {
		themeDialogAction.value = 'update'
		showThemeDialog.value = true
	} else if (action == 'export') {
		exportPdf()
	}
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
