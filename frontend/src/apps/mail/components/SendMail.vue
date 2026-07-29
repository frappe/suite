<template>
	<component
		:is="isMobile ? SendMailMobileLayout : Dialog"
		v-model="show"
		:options="{ title: __('Compose Mail'), size: '5xl' }"
		@reload-mails="() => emit('reloadMails')"
		@send-mail="editor?.sendMail()"
		@discard-mail="editor?.discardMail()"
	>
		<template #body-content>
			<ComposeMailEditor
				v-if="show || !isMobile"
				ref="composeMailEditor"
				v-model="show"
				v-model:draft="draft"
				:mail-details
				:reload-mails="() => emit('reloadMails')"
				@discard-mail="emit('discardMail')"
			/>
		</template>
	</component>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { Dialog } from 'frappe-ui'

import { useScreenSize } from '@/apps/mail/utils/composables'
import ComposeMailEditor from '@/apps/mail/components/ComposeMailEditor.vue'
import SendMailMobileLayout from '@/apps/mail/components/SendMailMobileLayout.vue'

import type { ComposeMailData } from '@/apps/mail/types'

const show = defineModel<boolean>()

const { mailDetails } = defineProps<{ mailDetails?: ComposeMailData }>()

const emit = defineEmits(['reloadMails', 'discardMail'])

const { isMobile } = useScreenSize()

// Crossing the breakpoint swaps the wrapper above, and the editor is unmounted along with
// it — so the mail being written is held here, outside the swap, and handed straight back
// to the instance that takes its place. Released when the composer closes (and whenever it
// is handed a different draft), so the next one opens fresh.
const draft = ref<ComposeMailData>()

watch(show, (val) => {
	if (!val) draft.value = undefined
})

watch(
	() => mailDetails,
	() => (draft.value = undefined),
)

const editor = useTemplateRef('composeMailEditor')

const handleKeydown = (e: KeyboardEvent) => {
	if (show.value && e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
		const target = e.target as HTMLElement
		if (
			target.tagName !== 'INPUT' &&
			target.tagName !== 'TEXTAREA' &&
			!target.isContentEditable
		) {
			e.preventDefault()
			e.stopPropagation()
		}
	}
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))
</script>
