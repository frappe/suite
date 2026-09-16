<template>
	<KeyboardShortcutsDialog v-model:open="open" :title="__('Keyboard Shortcuts')">
		<template #default>
			<div class="grid max-h-[70vh] grid-cols-1 gap-8 gap-x-6 overflow-y-auto pr-1 md:grid-cols-2 lg:grid-cols-3">
				<div v-for="(column, index) in columns" :key="index" class="space-y-8">
					<div v-for="group in column" :key="group.title" class="space-y-1">
						<h3 class="mb-3 text-base-medium tracking-wide text-ink-gray-8">
							{{ group.title }}
						</h3>
						<div
							v-for="shortcut in group.shortcuts"
							:key="shortcut[1]"
							class="grid grid-cols-[1fr_auto] items-start gap-3 rounded-4 py-0.5"
						>
							<span class="text-p-base text-ink-gray-6">{{ shortcut[1] }}</span>
							<div class="flex shrink-0 items-center gap-1.5">
								<template v-if="shortcutPresentation(shortcut[0]).sequence">
									<template
										v-for="(combo, comboIndex) in shortcutPresentation(shortcut[0]).combos"
										:key="combo"
									>
										<span v-if="comboIndex" class="text-xs text-ink-gray-4">{{ __('then') }}</span>
										<KeyboardShortcut :combo="combo" bg />
									</template>
								</template>
								<KeyboardShortcut
									v-else
									:combo="shortcutPresentation(shortcut[0]).combos[0]"
									:alt-combos="shortcutPresentation(shortcut[0]).combos.slice(1)"
									bg
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>
	</KeyboardShortcutsDialog>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { KeyboardShortcut, KeyboardShortcutsDialog } from 'frappe-ui'

import { type MailboxRole, userStore } from '@/apps/mail/stores/user'

const { mailboxes } = userStore()

const mailboxName = (role: MailboxRole) => mailboxes.data?.find((m) => m.role === role)?._name

const open = defineModel<boolean>('open', { default: false })
const modifier = 'Mod'

const shortcutGroups = computed(() => [
	[
		{
			title: __('Compose'),
			shortcuts: [
				[['C'], __('Compose New Mail')],
				[[modifier, 'Enter'], __('Send Mail')],
				[[modifier, 'Shift', 'Enter'], __('Schedule Send')],
				[[modifier, 'Z'], __('Undo Send')],
				[[modifier, 'D'], __('Discard Draft')],
				[['R'], __('Reply to Mail')],
				[['Shift', 'R'], __('Reply All to Mail')],
				[['F'], __('Forward Mail')],
			],
		},

		{
			title: __('Actions'),
			shortcuts: [
				[[modifier, 'A'], __('Select All Mails')],
				[['Esc'], __('Clear All Mails')],
				[['Shift', '↓', __('or'), 'Shift', 'J'], __('Toggle Select Downwards')],
				[['Shift', '↑', __('or'), 'Shift', 'K'], __('Toggle Select Upwards')],
				[['!'], __('Mark as Junk')],
				[['U'], __('Mark as Unread')],
				[['Shift', 'U'], __('Mark as Read')],
				[['E'], __('Archive')],
				[['Delete'], __('Move to Trash')],
				[['Shift', 'Delete'], __('Permanently Delete')],
				[[modifier, 'Z'], __('Undo Last Action')],
			],
		},

		{
			// The two plain verdicts first, then the qualified ones. Those two keep the keys the
			// Actions above use, because they are the same intent — allowing the sender is implied,
			// and the key says where their waiting mail goes.
			title: __('Screener'),
			shortcuts: [
				[['A'], __('Allow Sender')],
				[['D'], __('Deny Sender')],
				[['E'], __('Allow Sender, Archive Their Mail')],
				[['Delete'], __('Allow Sender, Trash Their Mail')],
			],
		},
	],
	[
		{
			title: __('Navigation'),
			shortcuts: [
				[['↓', __('or'), 'J'], __('Go to Next Item')],
				[['↑', __('or'), 'K'], __('Go to Previous Item')],
				[['G', __('then'), 'G'], __('Go to Top of List')],
				[['Shift', 'G'], __('Go to Bottom of List')],
				[['Enter'], __('Open Mail, or Fold Stack')],
				[[modifier, 'K'], __('Search Mail')],
				[['G', __('then'), 'I'], __('Go to {0}', [mailboxName('inbox')])],
				[['G', __('then'), 'F'], __('Go to Starred')],
				[['G', __('then'), 'S'], __('Go to {0}', [mailboxName('sent')])],
				[['G', __('then'), 'D'], __('Go to {0}', [mailboxName('drafts')])],
				[['G', __('then'), 'O'], __('Go to Outbox')],
				[['G', __('then'), 'J'], __('Go to {0}', [mailboxName('junk')])],
				[['G', __('then'), 'E'], __('Go to {0}', [mailboxName('archive')])],
				[['G', __('then'), 'T'], __('Go to {0}', [mailboxName('trash')])],
				[['G', __('then'), 'A'], __('Go to All Inboxes')],
				[['G', __('then'), 'R'], __('Go to Screener')],
			],
		},
		{
			title: __('Other'),
			shortcuts: [
				[[modifier, 'Shift', ','], __('Open Settings')],
				[[modifier, ';'], __('Toggle Sidebar')],
				[[modifier, 'Shift', 'L'], __('Cycle Theme')],
				[['?'], __('View Shortcuts')],
			],
		},
	],
])

const columns = computed(() => {
	const [compose, actions, screener, navigation, other] = shortcutGroups.value.flat()
	return [
		[compose, screener],
		[actions, other],
		[navigation],
	]
})

const keyNames: Record<string, string> = {
	'↓': 'ArrowDown',
	'↑': 'ArrowUp',
	'!': 'Shift+Digit1',
	'?': 'Shift+Slash',
	',': 'Comma',
	';': 'Semicolon',
	Esc: 'Escape',
}

function combo(tokens: string[]) {
	return tokens.map((token) => keyNames[token] || token).join('+')
}

function shortcutPresentation(keys: string[]) {
	const thenIndex = keys.indexOf(__('then'))
	if (thenIndex !== -1) {
		return {
			sequence: true,
			combos: [combo(keys.slice(0, thenIndex)), combo(keys.slice(thenIndex + 1))],
		}
	}

	const combos: string[] = []
	let start = 0
	for (let index = 0; index <= keys.length; index++) {
		if (index === keys.length || keys[index] === __('or')) {
			combos.push(combo(keys.slice(start, index)))
			start = index + 1
		}
	}
	return { sequence: false, combos }
}
</script>
