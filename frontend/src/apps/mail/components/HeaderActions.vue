<template>
	<!-- On mobile the tab bar owns these actions (Search tab, Compose FAB, Profile
	     tab); the header is CSS-hidden there but stays mounted so these modals
	     remain reachable via v-model from views. -->
	<div v-if="!isMobile" class="flex space-x-2">
		<Button
			icon="search"
			:tooltip="__('Search ({0}+K)', [modifier])"
			variant="ghost"
			@click="showSearchModal = true"
		/>
		<Button
			icon-left="edit"
			:label="__('Compose')"
			:tooltip="__('Compose (C)')"
			@click="compose()"
		/>
	</div>

	<SendMail v-model="showSendModal" @reload-mails="emit('reloadMails')" />
	<SearchModal
		v-model="showSearchModal"
		v-model:show-advanced="showSearchAdvanced"
		v-model:edit-filter="showSearchEditFilter"
	/>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Button } from 'frappe-ui'

import { isMac } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { restoreComposeWindow } from '@/apps/mail/composables/useComposeWindow'
import SearchModal from '@/apps/mail/components/Modals/SearchModal.vue'
import SendMail from '@/apps/mail/components/SendMail.vue'

const { isMobile } = useScreenSize()

const emit = defineEmits(['reloadMails'])

// Exposed as a model so other views (e.g. the search results header's query chip) can reopen the modal.
const showSearchModal = defineModel<boolean>('showSearch', { default: false })
const showSearchAdvanced = defineModel<boolean>('showAdvanced', { default: false })
// Filter key a results-page chip asked to reopen inline; forwarded to the search modal.
const showSearchEditFilter = defineModel<string>('editFilter', { default: '' })
const showSendModal = ref(false)

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

// Compose means "put a composer in front of me". If one is already open it is that one, brought
// back from the corner if it was minimised — starting a second would close it and take the draft
// with it. Only with nothing open does this begin a new draft.
const compose = () => {
	if (restoreComposeWindow()) return
	showSendModal.value = true
}

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

	// Compose shortcut. A composer that is already open swallows `c` before this (SendMail listens
	// in the capture phase), so this only ever starts a new one.
	if (key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
		e.preventDefault()
		compose()
	}
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>
