<template>
	<!-- On mobile the tab bar owns these actions (Search tab, Compose FAB, Profile
	     tab); the header is CSS-hidden there but stays mounted so these modals
	     remain reachable via v-model from views. -->
	<div v-if="!isMobile" class="flex space-x-2">
		<Button
			icon="lucide-search"
			:tooltip="__('Search ({0}+K)', [modifier])"
			variant="ghost"
			@click="showSearchModal = true"
		/>
		<Button
			icon-left="lucide-pencil"
			:label="__('Compose')"
			:tooltip="__('Compose (C)')"
			@click="compose()"
		/>
	</div>

	<SearchModal
		v-model="showSearchModal"
		v-model:show-advanced="showSearchAdvanced"
		v-model:edit-filter="showSearchEditFilter"
	/>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { Button } from 'frappe-ui'

import { isMac } from '@/apps/mail/utils'
import { useComposeMail, useScreenSize } from '@/apps/mail/utils/composables'
import SearchModal from '@/apps/mail/components/Modals/SearchModal.vue'

const { isMobile } = useScreenSize()
const { requestCompose } = useComposeMail()

// Exposed as a model so other views (e.g. the search results header's query chip) can reopen the modal.
const showSearchModal = defineModel<boolean>('showSearch', { default: false })
const showSearchAdvanced = defineModel<boolean>('showAdvanced', { default: false })
// Filter key a results-page chip asked to reopen inline; forwarded to the search modal.
const showSearchEditFilter = defineModel<string>('editFilter', { default: '' })

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

// Asked of the layout rather than answered here, because a composer mounted in this header would be
// a composer belonging to this view: leave the mailbox for the screener and the draft goes with the
// header it was started from. The layout outlives every route in the app, so that is where the
// window lives — and it is the layout that knows a request means the dock on desktop and the
// compose page on mobile.
//
// Compose means "a new mail", always — never the draft already in the corner. A composer that is
// open loses the window to this one and closes, which costs it nothing: it saves what it holds on
// the way out, and the draft is waiting in Drafts. Reaching back for it instead made the button
// answer a request nobody had made, and left no way at all to start a second mail.
const compose = () => requestCompose({})

const handleKeydown = (e: KeyboardEvent) => {
	const target = e.target as HTMLElement
	if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		return

	const key = e.key.toLowerCase()

	// Search shortcut
	if ((e.metaKey || e.ctrlKey) && key === 'k') {
		e.preventDefault()
		showSearchModal.value = true
		return
	}

	// Compose shortcut. It reaches here with a composer already open, too — `c` starts a new mail
	// wherever it is pressed, and typing into a composer is caught by the field test above.
	if (key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
		e.preventDefault()
		compose()
	}
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>
