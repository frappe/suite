<template>
	<div v-if="screeningEnabled" class="flex h-full flex-col">
		<!-- On mobile this is the shared title header (minus the hamburger) and it
		     absorbs the count bar's actions; desktop keeps breadcrumbs + count bar. -->
		<header
			class="flex items-center justify-between border-b px-3 py-2.5 max-sm:p-0 sm:px-5"
		>
			<MobileTitleHeader
				v-if="isMobile"
				class="min-w-0 flex-1"
				:title="__('Screener')"
				:count="senders.data?.length ? waitingLabel : undefined"
			>
				<template #actions>
					<AdaptiveDropdown :options="bulkOptions" placement="bottom-end">
						<Button variant="ghost" class="!h-10 !w-10 !rounded-full">
							<template #icon><Ellipsis class="icon" /></template>
						</Button>
					</AdaptiveDropdown>
				</template>
			</MobileTitleHeader>
			<!-- -ml-0.5 cancels the crumb's own padding so the title sits on the px-5 axis -->
			<Breadcrumbs v-else :items="[{ label: __('Screener') }]" class="-ml-0.5" />
			<HeaderActions @reload-mails="senders.reload()" />
		</header>

		<!-- First-visit explainer — a full-width slab under the header, spanning list and reading
		     pane. Dismissal sticks per device (education, not account state). -->
		<div
			v-if="!explainerDismissed && senders.data?.length && !(openSender && !showReadingPane)"
			class="bg-surface-blue-1 flex shrink-0 items-start gap-3 border-b px-5 py-4"
		>
			<div class="min-w-0 flex-1">
				<div class="text-ink-gray-8 text-base !font-semibold">
					{{ __('New senders wait here first') }}
				</div>
				<!-- The rows act through icon buttons, so the copy shows the icons next to the words
				     they stand for — "Allow" and "Deny" appear nowhere else in the view. -->
				<p class="text-ink-gray-6 mt-1 text-sm !leading-[1.5]">
					{{
						__(
							'The first time someone emails you, their message lands in the Screener instead of your Inbox.',
						)
					}}
					<!-- nowrap keeps each word+icon parenthetical on one line -->
					<span class="whitespace-nowrap">
						{{ __('Allow') }} (<Check
							class="inline h-3.5 w-3.5 stroke-2 align-[-2.5px]"
						/>)
					</span>
					{{ __('a sender once and their emails reach your Inbox from then on;') }}
					<span class="whitespace-nowrap">
						{{ __('Deny') }} (<X
							class="inline h-3.5 w-3.5 stroke-2 align-[-2.5px]"
						/>)
					</span>
					{{ __('sends them to Junk.') }}
				</p>
			</div>
			<Button
				variant="ghost"
				class="-mr-2 -mt-2"
				:tooltip="__('Dismiss')"
				@click="dismissExplainer"
			>
				<template #icon><X class="icon" /></template>
			</Button>
		</div>

		<div class="relative flex flex-1 overflow-hidden">
			<!-- Loading the sender list — centered like the mailbox empty/loading states. -->
			<div
				v-if="senders.loading && !senders.data"
				class="flex h-[calc(100dvh-6.1rem)] w-full flex-col items-center justify-center"
			>
				<div class="text-ink-gray-5 flex items-center space-x-2">
					<LoaderCircle class="h-5 w-5 animate-spin" />
					<span>{{ __('Loading...') }}</span>
				</div>
			</div>

			<!-- Nothing to screen — one centered empty screen, no split. -->
			<div
				v-else-if="!senders.data?.length"
				class="text-ink-gray-5 flex h-[calc(100dvh-6.1rem)] w-full flex-col items-center justify-center"
			>
				<NoMails class="text-ink-gray-2 mb-2 h-16 w-16" />
				<p>{{ __('You have no new senders to screen.') }}</p>
			</div>

			<template v-else>
				<!-- Sender list -->
				<div
					class="flex flex-col overflow-y-auto"
					:class="!isMobile && showReadingPane ? SPLIT_LIST_CLASS : 'w-full'"
				>
					<div class="pb-20">
						<!-- Count bar — matches the mailbox "All Mails" toolbar height/style. -->
						<!-- Desktop-only: on mobile the header above carries these actions. -->
						<div class="hidden min-h-[49px] items-center justify-between border-b px-5 sm:flex">
							<div class="flex min-w-0 items-center">
								<span class="truncate">{{ waitingLabel }}</span>
								<!-- Redundant while the explainer slab is teaching the same lesson above,
								     and skipped on mobile where the popover doesn't sit well. -->
								<Popover v-if="explainerDismissed && !isMobile" placement="bottom-start">
									<template #target="{ togglePopover }">
										<Button
											variant="ghost"
											class="ml-1 !px-1.5"
											:tooltip="__('How the Screener works')"
											@click="togglePopover()"
										>
											<template #icon><CircleHelp class="icon" /></template>
										</Button>
									</template>
									<template #body-main>
										<div class="w-80 p-4">
											<div class="text-ink-gray-8 mb-1.5 text-sm !font-semibold">
												{{ __('How the Screener works') }}
											</div>
											<p class="text-ink-gray-6 text-sm !leading-[1.5]">
												{{ __('First-time senders wait here until you decide.') }}
												<!-- nowrap keeps each word+icon parenthetical on one line -->
												<span class="whitespace-nowrap">
													{{ __('Allow') }} (<Check
														class="inline h-3.5 w-3.5 stroke-2 align-[-2.5px]"
													/>)
												</span>
												{{ __('a sender and their emails go to your Inbox — now and in the future.') }}
												<span class="whitespace-nowrap">
													{{ __('Deny') }} (<X
														class="inline h-3.5 w-3.5 stroke-2 align-[-2.5px]"
													/>)
												</span>
												{{ __('sends them to Junk.') }}
											</p>
											<p class="text-ink-gray-6 mt-3 text-sm !leading-[1.5]">
												{{ __('You can undo decisions or turn the Screener off in') }}
												<a
													class="cursor-pointer underline"
													@click="openSettings(__('Screener'))"
												>{{ __('Settings') }}</a>{{ '.' }}
											</p>
										</div>
									</template>
								</Popover>
							</div>
							<div class="-mr-2 flex shrink-0 items-center space-x-2">
								<Dropdown :options="bulkOptions" placement="bottom-end">
									<Button variant="ghost" class="!px-1.5">
										<template #icon><Ellipsis class="icon" /></template>
									</Button>
								</Dropdown>
								<SplitViewToggle />
							</div>
						</div>

						<div
							v-for="sender in senders.data"
							:key="sender.from_email"
							:data-sender-email="sender.from_email"
							class="sm:hover:bg-surface-gray-1 flex cursor-default select-none items-stretch gap-4 border-b px-5 py-2.5"
							:class="{
								'!bg-surface-blue-1': openSender?.from_email === sender.from_email,
							}"
							@click="selectSender(sender)"
						>
							<div class="min-w-0 flex-1 space-y-1">
								<div class="flex min-w-0 items-baseline gap-2">
									<!-- Same dot the mail lists use for unread, meaning the same thing here: nobody
									     has looked yet. It clears on reading the preview; the sender stays until
									     allowed or denied, seen not being a decision. -->
									<span
										v-if="sender.unread"
										class="bg-blue-500 size-2 shrink-0 self-center rounded-full"
										:aria-label="__('Unread')"
									/>
									<!-- Weights follow the mail rows: medium once read, semibold while unread,
									     so a screened sender reads the same as anything else in a list. -->
									<span
										class="text-ink-gray-8 truncate text-[15px] !font-medium sm:text-base"
										:class="{ '!font-semibold': sender.unread }"
									>
										{{ sender.from_name || sender.from_email }}
									</span>
									<span class="text-ink-gray-5 flex-1 truncate text-[13px]">{{ sender.from_email }}</span>
									<MailDate
										v-if="isMobile"
										:datetime="sender.received_at"
										:in-list="true"
										class="text-ink-gray-4 shrink-0 whitespace-nowrap text-xs tabular-nums"
									/>
								</div>
								<div
									class="text-ink-gray-8 truncate text-sm !leading-[1.5]"
									:class="{ '!font-semibold': sender.unread }"
								>
									{{ sender.subject || __('[No subject]') }}
								</div>
								<div
									v-if="sender.preview || sender.count > 1"
									class="text-ink-gray-5 truncate text-sm !leading-[1.5]"
								>
									<span v-if="sender.preview">{{ sender.preview }}</span>
									<span v-if="sender.count > 1">
										{{ sender.preview ? ' · ' : '' }}{{ __('{0} messages', [String(sender.count)]) }}
									</span>
								</div>
								<!-- Variant E: full-width labeled verdict pills — x/check icons alone
								     relied on tooltips, which never fire on touch. -->
								<div v-if="isMobile" class="flex gap-2 pt-1.5">
									<Button
										variant="outline"
										class="!h-8 flex-1"
										:label="__('Deny')"
										@click.stop="screenOut([sender.from_email])"
									>
										<template #prefix><X class="h-4 w-4" /></template>
									</Button>
									<Button
										variant="outline"
										class="!h-8 flex-1"
										:label="__('Allow')"
										@click.stop="allow([sender.from_email])"
									>
										<template #prefix><Check class="h-4 w-4" /></template>
									</Button>
								</div>
							</div>

							<!-- Received time, with Deny / Allow icon buttons -->
							<div v-if="!isMobile" class="flex shrink-0 flex-col items-end justify-between">
								<MailDate
									:datetime="sender.received_at"
									:in-list="true"
									class="text-ink-gray-4 whitespace-nowrap pt-px text-xs tabular-nums"
								/>
								<div class="flex gap-2">
									<Button
										variant="outline"
										:tooltip="__('Deny')"
										@click.stop="screenOut([sender.from_email])"
									>
										<template #icon><X class="h-4 w-4" /></template>
									</Button>
									<Button
										variant="outline"
										:tooltip="__('Allow')"
										@click.stop="allow([sender.from_email])"
									>
										<template #icon><Check class="h-4 w-4" /></template>
									</Button>
								</div>
							</div>
						</div>

					</div>
				</div>

				<!-- Read-only thread preview — split when the reading pane is on, full-width otherwise.
				     Teleported to body on mobile (like the selection bar): inside the layout's
				     isolate stacking context the tab bar would paint over the sliding pane. -->
				<Teleport to="body" :disabled="!isMobile">
				<div
					class="bg-surface-base flex flex-col"
					:class="{
						[SPLIT_PANE_CLASS]: !isMobile && showReadingPane,
						'absolute bottom-0 left-0 right-0 top-0': !isMobile && !showReadingPane,
						'fixed inset-0 z-20 pt-[env(safe-area-inset-top)] transition-[transform,visibility] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]':
							isMobile,
						'invisible translate-x-full': isMobile && !openSender,
						hidden: !isMobile && !showReadingPane && !openSender,
					}"
					@touchstart.passive="onPreviewTouchStart"
					@touchend.passive="onPreviewTouchEnd"
				>
					<template v-if="openSender">
						<!-- Subject + Deny/Allow; back button only when the preview owns the whole pane -->
						<div
							class="bg-surface-base border-b sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 p-2.5 max-sm:border-b-0 sm:px-5"
						>
							<div class="flex min-w-0 items-center">
								<Button
									variant="ghost"
									class="-ml-1.5 mr-2 shrink-0"
									@click="closeSender"
								>
									<template #icon>
										<ChevronLeft class="icon" />
									</template>
								</Button>
								<!-- On mobile the thread header right below shows the subject already. -->
								<h2 v-if="!isMobile" class="truncate font-semibold leading-5">
									{{ openSender.subject || __('[No subject]') }}
								</h2>
							</div>
							<!-- The phone's counterpart to the desktop split-buttons: the bar below answers yes or
							     no, and everything narrower than that — Archive, Trash, the whole domain — lives
							     here, where the thread view keeps its overflow too. -->
							<AdaptiveDropdown v-if="isMobile" :options="moreOptions(openSender)">
								<Button variant="ghost" :aria-label="__('More actions')">
									<template #icon><Ellipsis class="icon" /></template>
								</Button>
							</AdaptiveDropdown>
							<!-- Desktop only: on a phone the verdict moves to a bar at the bottom, where
							     the thread view puts Reply and Forward — the reachable edge, and the same
							     place the same kind of decision is made everywhere else in the app. -->
							<div v-if="!isMobile" class="flex shrink-0 gap-2">
								<div class="flex items-center">
									<!-- The key is named on the tooltip rather than in the label: this is the
									     desktop split-button pair, so there is a keyboard to press it on, and
									     the qualified verdicts in the menu behind it name theirs the same way. -->
									<Button
										variant="outline"
										:label="__('Deny')"
										:tooltip="__('Deny ({0})', ['D'])"
										class="!rounded-r-none"
										@click="screenOut([openSender.from_email])"
									/>
									<AdaptiveDropdown
										:options="denyOptions(openSender)"
										placement="bottom-end"
									>
										<Button variant="outline" class="-ml-px !rounded-l-none !px-1.5">
											<template #icon><ChevronDown class="h-4 w-4" /></template>
										</Button>
									</AdaptiveDropdown>
								</div>
								<div class="flex items-center">
									<Button
										variant="solid"
										:label="__('Allow')"
										:tooltip="__('Allow ({0})', ['A'])"
										class="!rounded-r-none"
										@click="allow([openSender.from_email])"
									/>
									<AdaptiveDropdown
										:options="allowOptions(openSender)"
										placement="bottom-end"
									>
										<Button
											variant="solid"
											class="!rounded-l-none !px-1.5"
											style="border-left: 1px solid color-mix(in srgb, currentColor 35%, transparent)"
										>
											<template #icon><ChevronDown class="h-4 w-4" /></template>
										</Button>
									</AdaptiveDropdown>
								</div>
							</div>
						</div>

						<!-- Keyed by sender so a swipe pages like the mailbox thread view: the old
					     preview slides out while the next sender's slides in. -->
						<div class="relative min-h-0 flex-1 overflow-hidden">
							<Transition :name="senderSlide" @after-enter="senderSlide = ''">
								<div :key="senderPaneKey" class="flex h-full flex-col">
									<MailThreadSkeleton v-if="previewLoading" />
									<!-- readonly for the actions (this is a decision about a sender, not a
									     conversation to act on), but marks-seen because reading is reading:
									     the Inbox banner counts unread here, so leaving it unread nagged
									     people who had looked and were deferring the decision. -->
									<MailThread
										v-else-if="previewMails?.length"
										class="min-h-0 flex-1"
										readonly
										mailbox=""
										:thread-i-d="openSender.from_email"
										:threads="[]"
										:messages="previewMails"
										@set-seen="markSenderSeen"
									/>
								</div>
							</Transition>

							<!-- Mirrors the thread's reply bar: full-bleed, split down the middle, tall enough to
							     hit without looking. The preview already reserves pb-16 on mobile for exactly this.
							     Deny carries no destination; Allow files to the Inbox, the split menus on desktop
							     covering the rest. -->
							<div
								v-if="isMobile"
								class="bg-surface-base absolute bottom-0 left-0 right-0 z-20 flex items-stretch border-t"
							>
								<Button
									variant="ghost"
									:icon-left="X"
									:label="__('Deny')"
									class="!h-16 flex-1 rounded-none"
									@click="screenOut([openSender.from_email])"
								/>
								<Button
									variant="ghost"
									:icon-left="Check"
									:label="__('Allow')"
									class="!h-16 flex-1 rounded-none"
									@click="allow([openSender.from_email])"
								/>
							</div>
						</div>
					</template>

					<div v-else class="flex-1 overflow-hidden">
						<div
							class="bg-surface-gray-1 m-5 flex h-[calc(100%-2.9em)] items-center justify-center rounded-md"
						>
							<div class="flex flex-col items-center space-y-3">
								<NoMails class="text-ink-gray-2 h-16 w-16" />
								<p class="text-ink-gray-4">
									{{ __('Select a sender to view their emails.') }}
								</p>
							</div>
						</div>
					</div>
				</div>
				</Teleport>
			</template>
		</div>

		<Dialog v-model="showClearAll" :options="clearAllOptions" />
		<Dialog v-model="showBulkConfirm" :options="bulkConfirmOptions" />
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
	Archive,
	Check,
	Globe,
	GlobeOff,
	ChevronDown,
	ChevronLeft,
	CircleHelp,
	Ellipsis,
	Inbox,
	LoaderCircle,
	Trash2,
	X,
} from 'lucide-vue-next'
import {
	Breadcrumbs,
	Button,
	Dialog,
	Dropdown,
	Popover,
	call,
	createResource,
	toast,
	usePageMeta,
} from 'frappe-ui'

import { raiseToast, shouldIgnoreKeypress } from '@/apps/mail/utils'
import { isNavigationKey, navigationOffset } from '@/apps/mail/utils/listNavigation'
import {
	useReadingPane,
	useScreenSize,
	useSettings,
	useSwipeNav,
	useUndo,
} from '@/apps/mail/utils/composables'
import { SPLIT_LIST_CLASS, SPLIT_PANE_CLASS } from '@/apps/mail/constants'
import { userStore } from '@/apps/mail/stores/user'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailDate from '@/apps/mail/components/MailDate.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import SplitViewToggle from '@/apps/mail/components/SplitViewToggle.vue'
import MailThreadSkeleton from '@/apps/mail/components/MailThreadSkeleton.vue'

import type { Mail, MailboxData, ScreeningSender } from '@/apps/mail/types'

const store = userStore()
const { senderEmail } = defineProps<{
	/** The open sender, from the route. Absent on the plain screener route — the list, nothing open. */
	senderEmail?: string
}>()

const router = useRouter()
const { isMobile } = useScreenSize()
const { openSettings } = useSettings()

const showReadingPane = useReadingPane()

// The same undo the thread lists hang Cmd/Ctrl+Z off — one shared slot, so the last thing you did in
// mail is the thing that key takes back, wherever you did it.
const { setUndoAction, undo } = useUndo()

// The Screener only exists when screening is enabled. If it's off, render nothing and send the user to
// their inbox (the route is still reachable by URL even though the sidebar hides it).
const screeningEnabled = computed(
	() =>
		!!store.userResource?.data?.accounts?.find((a) => a.id === store.accountId)
			?.enable_screening,
)
watch(
	() => [!!store.userResource?.data, screeningEnabled.value, store.mailboxIds.inbox] as const,
	([ready, enabled, inboxId]) => {
		if (ready && !enabled && inboxId)
			router.replace({
				name: 'mail-mailbox',
				params: { accountId: store.accountId, mailbox: inboxId },
			})
	},
	{ immediate: true },
)

// The sender whose mail is open in the read-only preview, and that sender's messages.
const openSender = ref<ScreeningSender | null>(null)
const senderMails = createResource({
	url: 'suite.mail.api.mail.get_screening_sender_mails',
	makeParams: () => ({ account: store.accountId, from_email: openSender.value?.from_email }),
})

// The preview reads `previewMails`, not the resource's `.data`: fast navigation fires several fetches
// at once and the resource flips `loading` off on the first reply that lands, so an out-of-order reply
// could otherwise leak the previous sender in (and the thread then appends the next one onto it). Each
// fetch carries a token; only the most recent one is applied.
const previewMails = ref<Mail[]>()
const previewLoading = ref(false)
let previewToken = 0

/**
 * Which sender is open is the URL's business, so opening one is a navigation and the back gesture
 * closes it — on mobile the preview is a full-screen overlay, and without this back left the screener
 * entirely. `replace` for the steps that aren't a new decision to open something (paging with j/k,
 * and the hop to the next sender after a verdict), so a triage run doesn't stack an entry per sender.
 */
const selectSender = (sender: ScreeningSender, replace = false) => {
	if (openSender.value?.from_email === sender.from_email) return
	const to = {
		name: 'mail-screener-sender',
		params: { accountId: store.accountId, senderEmail: sender.from_email },
	}
	replace ? router.replace(to) : router.push(to)
}

/** Loads the preview for whichever sender the route names. */
const openSenderFromRoute = (sender: ScreeningSender) => {
	if (openSender.value?.from_email === sender.from_email) return
	openSender.value = sender

	const token = ++previewToken
	previewMails.value = undefined
	previewLoading.value = true
	;(senderMails.reload() as Promise<Mail[]>)
		.then((mails) => {
			if (token !== previewToken) return
			previewMails.value = mails ?? []
			previewLoading.value = false
		})
		.catch(() => {
			if (token === previewToken) previewLoading.value = false
		})
}

const closeSender = () => {
	if (!openSender.value) return
	// Back where there is something to go back to, so opening and closing leaves no residue in the
	// history; a sender opened straight from a pasted URL has nothing behind it, so replace instead.
	const list = { name: 'mail-screener', params: { accountId: store.accountId } }
	if (router.options.history.state.back) router.back()
	else router.replace(list)
}

/**
 * Reading a sender's mail in the preview marks it seen on the server, and clears their unread count
 * here without waiting for a refetch — the row's dot and the Inbox's "waiting to be screened" banner
 * both read off that number, and neither should linger after you have looked.
 *
 * The sender stays in the list: seen is not a decision. They leave when allowed or denied.
 */
const markSenderSeen = (seen: boolean, ids: string[]) => {
	if (!seen || !ids.length) return

	call('suite.mail.api.mail.set_mails_seen', { account: store.accountId, ids, seen: true })
		.then(() => store.mailboxes.reload())
		.catch((error) => raiseToast(error?.messages?.[0] || error?.message, 'error'))

	const sender = senders.data?.find(
		(s: ScreeningSender) => s.from_email === openSender.value?.from_email,
	)
	if (sender) sender.unread = 0
	previewMails.value?.forEach((mail) => (mail.seen = 1))
}

const senders = createResource({
	url: 'suite.mail.api.mail.get_screening_senders',
	makeParams: () => ({ account: store.accountId }),
	auto: true,
})

/**
 * Senders this view has just judged, held only until the route stops naming them.
 *
 * A verdict drops the row from the list and navigates to the next sender in the same breath, but the
 * navigation resolves a tick later than the list changes. In between, the route still names someone
 * the list can no longer find — which is exactly the shape of a stale URL, and the watcher below
 * would bounce it back to the list, cancelling the advance that was already in flight.
 */
const justActed = new Set<string>()

/**
 * The route names a sender; this finds them in the list and opens them. A sender who has already been
 * allowed or denied is simply gone — normal here rather than exceptional, since the queue empties as
 * you work — so that lands quietly back on the list instead of erroring.
 */
watch(
	[() => senderEmail, () => senders.data],
	([email, list]) => {
		if (!email) {
			justActed.clear()
			openSender.value = null
			return
		}
		if (!list) return

		const sender = (list as ScreeningSender[]).find(
			(s: ScreeningSender) => s.from_email === email,
		)
		if (sender) {
			// The route has caught up with the list, so nothing is still in flight.
			justActed.clear()
			openSenderFromRoute(sender)
		} else if (!justActed.has(email)) {
			router.replace({ name: 'mail-screener', params: { accountId: store.accountId } })
		}
	},
	{ immediate: true },
)

// Swipe on the open preview (mobile): left → next sender, right → previous — the
// screener counterpart of the mailbox thread swipe.
const { onTouchStart: onPreviewTouchStart, onTouchEnd: onPreviewTouchEnd } = useSwipeNav(
	() => isMobile.value && !!openSender.value,
	(offset) => {
		const list = senders.data ?? []
		const idx = list.findIndex(
			(s: ScreeningSender) => s.from_email === openSender.value!.from_email,
		)
		const next = idx === -1 ? undefined : list[idx + offset]
		if (!next) return
		// Arms the paging animation for this navigation only — row taps and the allow/deny
		// auto-advance keep swapping instantly.
		senderSlide.value = offset > 0 ? 'page-next' : 'page-prev'
		selectSender(next, true)
	},
)

// The <Transition> name while a swipe navigation renders; cleared after the slide.
const senderSlide = ref('')

// The preview wrapper's key: follows the open sender but freezes on close, so the pane's
// slide-out still shows the preview it closed on instead of a remounted blank wrapper.
const senderPaneKey = ref('none')
watch(openSender, (sender) => {
	if (sender) senderPaneKey.value = sender.from_email
})

// Once a mail is open: ↑/↓ (or k/j) step senders, A and D give the two plain verdicts, E and Delete
// allow the sender straight to Archive or Trash, and Esc closes. Else inert.
const handleKeydown = (e: KeyboardEvent) => {
	const key = e.key.toLowerCase()

	// Above the guard below: a verdict is just as often given from a list row with nothing open, and
	// that is exactly when you'd reach for undo — the row is gone and there is nothing else to press.
	if ((e.metaKey || e.ctrlKey) && key === 'z' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		return undo()
	}

	if (!openSender.value || shouldIgnoreKeypress(e)) return

	if (key === 'escape') {
		e.preventDefault()
		closeSender()
		return
	}

	// The two plain verdicts — the ones every other key here is a qualified version of. Only these
	// were missing from the keyboard, so a pass down the queue could file the rarer decisions and had
	// to reach for the pointer for the common ones. Both keys are free: the mailbox map spends A only
	// with a modifier and never binds D.
	//
	// Modifier-free only, unlike the keys below — Cmd/Ctrl+A is Select All in the lists and select-all
	// in the browser, and neither should turn into a verdict on a stranger.
	if ((key === 'a' || key === 'd') && !e.metaKey && !e.ctrlKey && !e.altKey) {
		e.preventDefault()
		if (key === 'a') allow([openSender.value.from_email])
		else screenOut([openSender.value.from_email])
		return
	}

	// The mailbox's Archive and Trash keys, doing the screener's version of the same thing: the
	// sender is allowed in — that decision is what the screener is for — and the mail already waiting
	// is filed away rather than landing in the inbox to be triaged a second time. `runAction` steps to
	// the next sender, so a keyboard pass down the list keeps its place.
	if (key === 'e' || key === 'delete' || key === 'backspace') {
		e.preventDefault()
		runAction('allow', [openSender.value.from_email], undefined, key === 'e' ? 'archive' : 'trash')
		return
	}

	if (!isNavigationKey(key)) return

	e.preventDefault()
	const offset = navigationOffset(key)
	const list = senders.data ?? []
	const cur = list.findIndex(
		(s: ScreeningSender) => s.from_email === openSender.value!.from_email,
	)
	const next = list[cur + offset]
	if (!next) return

	selectSender(next, true)
	nextTick(() =>
		document
			.querySelector(`[data-sender-email="${next.from_email}"]`)
			?.scrollIntoView({ block: 'nearest' }),
	)
}

// Poll the Screening folder's count and only refetch the (heavier) sender list when it changes — the
// same cheap-count-then-reload approach the mailbox uses, so a quiet screener isn't reloaded every tick.
// Counting messages rather than threads: another mail from a sender already waiting here doesn't move
// the thread count.
const screeningCount = () =>
	store.mailboxes.data?.find((m: MailboxData) => m.id === store.mailboxIds.screener)?.total_emails

const pollForChanges = async () => {
	const prev = screeningCount()
	await store.mailboxes.reload()
	if (screeningCount() !== prev) senders.reload()
}

let pollInterval: ReturnType<typeof setInterval>

onMounted(() => {
	window.addEventListener('keydown', handleKeydown)
	pollInterval = setInterval(pollForChanges, 30000)
})

onUnmounted(() => {
	window.removeEventListener('keydown', handleKeydown)
	// Don't leave a verdict undoable from a view that can't show what came back.
	setUndoAction(undefined)
	clearInterval(pollInterval)
	// Don't strand a queued batch on navigation — the acted rows were already removed optimistically.
	if (flushTimer) {
		clearTimeout(flushTimer)
		flushScreening()
	}
})

usePageMeta(() => {
	const n = senders.data?.length ?? 0
	return { title: n ? `(${n}) ${__('Screener')}` : __('Screener') }
})

const waitingLabel = computed(() => {
	const n = senders.data?.length ?? 0
	return n === 1 ? __('1 new sender') : __('{0} new senders', [String(n)])
})

// Allowing a sender always lets their future mail through; the destination only decides where the
// mail already waiting in the Screener is filed — Inbox, or straight to Archive/Trash when you've
// read it here and don't want to triage it again.
type AllowDestination = 'inbox' | 'archive' | 'trash'

const allowResource = createResource({
	url: 'suite.mail.api.mail.allow_screening_senders',
	makeParams: ({
		from_emails,
		destination,
	}: {
		from_emails: string[]
		destination: AllowDestination
	}) => ({
		account: store.accountId,
		from_emails,
		destination,
	}),
})

const screenOutResource = createResource({
	url: 'suite.mail.api.mail.screen_out_senders',
	makeParams: ({ from_emails }: { from_emails: string[] }) => ({
		account: store.accountId,
		from_emails,
	}),
})

// Deny/Allow clicks are coalesced and flushed as one batched request per action. Triaging senders in
// quick succession otherwise fires a request per click, and each rebuilds the shared automation sieve —
// the concurrent rebuilds race on that single script and throw CannotChangeConstantError. The backend
// already accepts a list, so we just accumulate the burst and submit it once. A sender's latest action
// wins if both buttons are hit before the flush.
const SCREEN_FLUSH_DELAY = 500
// Allows carry their destination, so they batch per destination rather than as one set.
const pending = { allow: new Map<string, AllowDestination>(), screenOut: new Set<string>() }
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushChain: Promise<void> = Promise.resolve()

/**
 * Which mail a verdict actually moved, resolved once the flush that carried it comes back.
 *
 * Both endpoints answer with the ids they filed, keyed by sender, because afterwards there is no
 * finding that mail from the sender again — the server's lookup only searches the Screener, which the
 * verdict has just emptied of them. Undo is the only caller.
 */
const idsBySender = new Map<string, (ids: string[]) => void>()

const awaitVerdictIds = (fromEmail: string) =>
	new Promise<string[]>((resolve) => {
		// A second verdict on the same sender before the flush replaces the first, whose toast has been
		// replaced too — settle it empty rather than leaving an unresolvable promise behind.
		idsBySender.get(fromEmail)?.([])
		idsBySender.set(fromEmail, resolve)
	})

/** Hands each sender in a landed batch the ids that came back for them (none, if the call failed). */
const resolveVerdictIds = (fromEmails: string[], moved: Record<string, string[]> | undefined) => {
	for (const email of fromEmails) {
		const resolve = idsBySender.get(email)
		if (!resolve) continue
		idsBySender.delete(email)
		resolve(moved?.[email] ?? [])
	}
}

const flushScreening = () => {
	flushTimer = null
	const allowGroups = new Map<AllowDestination, string[]>()
	for (const [email, destination] of pending.allow) {
		const group = allowGroups.get(destination)
		if (group) group.push(email)
		else allowGroups.set(destination, [email])
	}
	const screenOutEmails = [...pending.screenOut]
	pending.allow.clear()
	pending.screenOut.clear()
	if (!allowGroups.size && !screenOutEmails.length) return

	// Chain onto the previous flush so requests never overlap (overlapping rebuilds are the bug).
	flushChain = flushChain.then(async () => {
		// Submit each action independently so one failing doesn't skip the other — a burst can mix
		// allow and screen-out across different senders, and all were already optimistically removed.
		let submitted = false
		let firstError: unknown
		for (const [destination, from_emails] of allowGroups) {
			try {
				const moved = await allowResource.submit({ from_emails, destination })
				resolveVerdictIds(from_emails, moved)
				submitted = true
			} catch (error) {
				firstError ??= error
				resolveVerdictIds(from_emails, undefined)
			}
		}
		if (screenOutEmails.length) {
			try {
				const junked = await screenOutResource.submit({ from_emails: screenOutEmails })
				resolveVerdictIds(screenOutEmails, junked)
				submitted = true
			} catch (error) {
				firstError ??= error
				resolveVerdictIds(screenOutEmails, undefined)
			}
		}
		// Allowing/screening senders changes inbox/junk counts too.
		if (submitted) store.mailboxes.reload()
		if (firstError) {
			senders.reload()
			raiseToast((firstError as Error).message || __('Action failed.'), 'error')
		}
	})
}

const queueScreening = (
	action: 'allow' | 'screenOut',
	fromEmails: string[],
	destination: AllowDestination,
) => {
	for (const email of fromEmails) {
		if (action === 'allow') {
			pending.screenOut.delete(email)
			pending.allow.set(email, destination)
		} else {
			pending.allow.delete(email)
			pending.screenOut.add(email)
		}
	}
	if (!flushTimer) flushTimer = setTimeout(flushScreening, SCREEN_FLUSH_DELAY)
}

// `matchSender` decides which rows this action clears from the list; by default the senders whose
// address is in `fromEmails`, but a domain action clears everyone in the domain (see runDomainAction).
const runAction = (
	action: 'allow' | 'screenOut',
	fromEmails: string[],
	matchSender: (s: ScreeningSender) => boolean = (s) => fromEmails.includes(s.from_email),
	destination: AllowDestination = 'inbox',
) => {
	if (!fromEmails.length) return

	// When acting on the sender open in the detail view, line up the next one down so you can triage
	// straight through — resolved before the optimistic removal.
	const list = senders.data ?? []
	const actingOnOpen = !!openSender.value && matchSender(openSender.value)
	let nextSender: ScreeningSender | undefined
	if (actingOnOpen) {
		const idx = list.findIndex(
			(s: ScreeningSender) => s.from_email === openSender.value!.from_email,
		)
		nextSender = list.slice(idx + 1).find((s: ScreeningSender) => !matchSender(s))
	}

	// Optimistically drop the acted senders so the rows leave immediately and every other row stays
	// interactive. Their names are remembered until the advance below lands, so the route naming one
	// of them for that tick isn't mistaken for a stale URL (see `justActed`).
	//
	// The rows themselves are kept, with where they sat, so undo can put them back without waiting
	// for the server to confirm what this never waited for either.
	const removed: RemovedSender[] = []
	list.forEach((s: ScreeningSender, index: number) => {
		if (!matchSender(s)) return
		justActed.add(s.from_email)
		removed.push({ index, sender: s })
	})
	senders.data = list.filter((s: ScreeningSender) => !matchSender(s))

	// Advance to the next sender (or close the preview if there's nothing below).
	if (actingOnOpen) {
		if (nextSender) selectSender(nextSender, true)
		else closeSender()
	}

	// Line up the ids this verdict will move, so the toast can offer to put that mail back. Every
	// shape has them: a domain rule answers under its own `@domain` key, a bulk action under one key
	// per sender — what comes back is what moved, whether or not this list showed it.
	const movedIds = Promise.all(fromEmails.map(awaitVerdictIds)).then((groups) => groups.flat())

	// `list`, not `senders.data`: the row has just been dropped from the list, and the toast still
	// wants to name the sender the way the row did. A domain target matches nobody, which is right.
	const acted =
		fromEmails.length === 1
			? list.find((s: ScreeningSender) => s.from_email === fromEmails[0])
			: undefined

	queueScreening(action, fromEmails, destination)
	announce(action, fromEmails, destination, movedIds, removed, acted?.from_name)
}

/**
 * Run the queued verdicts now, then hand back the ids the verdict moved.
 *
 * Undo acts on mail the batched flush is still holding a decision about, so the flush goes first — a
 * move that overtook it would simply be moved again by it. Forcing the timer only saves the wait; the
 * ids resolve from inside the flush either way.
 */
const settledVerdictIds = async (movedIds: Promise<string[]>) => {
	if (flushTimer) {
		clearTimeout(flushTimer)
		flushScreening()
	}
	await flushChain
	return movedIds
}

/**
 * A row the verdict took off the list, and where it sat, so undo can put it back.
 */
interface RemovedSender {
	index: number
	sender: ScreeningSender
}

/**
 * Put the acted rows back where they were, skipping any the list has since regained (a reload
 * overlapping the undo). Ascending index, so each splice lands before the next one is measured.
 */
const restoreSenders = (removed: RemovedSender[]) => {
	const list = [...((senders.data ?? []) as ScreeningSender[])]
	const present = new Set(list.map((s) => s.from_email))

	for (const { index, sender } of [...removed].sort((a, b) => a.index - b.index)) {
		if (present.has(sender.from_email)) continue
		list.splice(Math.min(index, list.length), 0, sender)
	}

	senders.data = list
}

/**
 * Take a verdict back: drop the rules it wrote and return the mail to the Screener, so the senders are
 * waiting to be decided about again exactly as they were.
 *
 * The rows come back first, before any of it. Applying a verdict never waited — it drops the rows and
 * batches the write behind a timer — so an undo that waited for that deferred write, then its own
 * round trip, then a full reload left the row missing for all three while the press that caused it
 * cost nothing. The ids the server needs only exist once the flush returns, but the list doesn't
 * depend on them.
 */
const undoVerdict = async (
	fromEmails: string[],
	undone: string,
	movedIds: Promise<string[]>,
	removed: RemovedSender[],
) => {
	// The verdict's own toast has served its purpose. Sonner clears it when its button is what was
	// pressed, but not when the keyboard was, so say so either way rather than leave it beside the
	// line about to replace it.
	toast.dismiss()

	// Back on the list, and answerable again: the route watcher can find these senders now, so the
	// names held for the advance are no longer standing in for them.
	restoreSenders(removed)
	for (const email of fromEmails) justActed.delete(email)

	// Said now, not when the server agrees. The rows are already back, so a confirmation arriving a
	// round trip later describes something the reader watched happen — and the line itself ("… is back
	// in the Screener") is about the list, which is already true. This is what raiseOptimisticToast
	// does for every other undoable action in mail; not reused here because its failure branch is one
	// generic line, and an undo that did not land is worth naming precisely.
	const pendingToast = raiseToast(undone)

	try {
		const ids = await settledVerdictIds(movedIds)
		// One call so the rules are dropped and the mail comes home together: a half-undone verdict —
		// the mail back in the Screener but the rule still standing — would let the senders past it.
		await call('suite.mail.api.mail.undo_screening_verdict', {
			account: store.accountId,
			from_emails: fromEmails,
			ids,
		})
		// Reconciliation, not the mechanism: the rows are already back. This settles what the optimistic
		// splice can only approximate — the server's ordering, and counts that moved while it was away.
		senders.reload()
		store.mailboxes.reload()
	} catch (error) {
		// The undo did not land, so the verdict still stands: retract the line that said otherwise and
		// let the refetch take the rows away again.
		toast.dismiss(pendingToast)
		senders.reload()
		raiseToast((error as Error).message || __('Could not undo that.'), 'error')
	}
}

// Long enough to read the line and reach for Undo, short enough not to sit over the next sender.
const VERDICT_TOAST_MS = 9000

/**
 * Say what a verdict did, and offer to take it back.
 *
 * A verdict used to pass in silence unless it filed mail somewhere the list couldn't show — the row
 * leaving was the feedback, and a toast per row is noise on a triage pass. It earns the interruption
 * now that it carries an Undo: a misfire on a list of strangers is the one mistake here you can't
 * spot afterwards, because the sender is gone from the list and their mail is filed somewhere you
 * weren't looking. The wider the verdict, the more that holds — a domain rule and Allow All clear
 * rows in one press and reach mail that was never on screen.
 */
const announce = (
	action: 'allow' | 'screenOut',
	fromEmails: string[],
	destination: AllowDestination,
	movedIds: Promise<string[]>,
	removed: RemovedSender[],
	senderName?: string,
) => {
	const target = fromEmails[0] ?? ''
	if (!target) return

	// Name what was decided about the way you saw it: the sender, as the row read them, falling back
	// to their address when they sent no name. A domain rule has no sender to name, so it keeps the
	// `@domain` the rule is written as; a sweep over the whole queue has no one name, so it counts.
	const count = fromEmails.length
	const subject = count > 1 ? __('{0} senders', [String(count)]) : senderName || target

	const verdict =
		action === 'allow' ? __('{0} allowed.', [subject]) : __('{0} denied.', [subject])

	// Archive and Trash file the mail somewhere this list can't show, and the verdict alone would
	// leave you looking for it in the Inbox. Phrased as the thread lists phrase the same two moves —
	// "archived" reads as a verb where "trashed" doesn't, so that one names the folder. "Mail" rather
	// than a count of messages: it is right whether one was waiting or nine.
	const message =
		action === 'allow' && destination === 'archive'
			? __('{0} Mail archived.', [verdict])
			: action === 'allow' && destination === 'trash'
				? __('{0} Mail moved to Trash.', [verdict])
				: verdict

	// Undoing lands somewhere the list can't show either, so it says so in the same terms.
	const undone =
		count > 1
			? __('{0} are back in the Screener.', [subject])
			: __('{0} is back in the Screener.', [subject])

	// Cmd/Ctrl+Z reaches the same verdict as the toast's button, and only the latest one: a triage
	// pass is a run of decisions, and each replaces the last as the one still in reach.
	setUndoAction(() => undoVerdict(fromEmails, undone, movedIds, removed))

	// One toast at a time. A run of verdicts would otherwise stack them over the list they are about,
	// and only the newest is still undoable — the rest would offer a button that took back someone
	// else's verdict. Every other undoable action in mail clears the same way, inside
	// raiseOptimisticToast; this one raises a plain toast, so it does its own.
	toast.dismiss()

	// Through `undo`, not the closure directly: it is what clears the slot, so pressing the button
	// leaves nothing behind for Cmd+Z to run a second time.
	raiseToast(message, 'success', { label: __('Undo'), onClick: () => undo() }, VERDICT_TOAST_MS)
}

const allow = (fromEmails: string[], destination: AllowDestination = 'inbox') =>
	runAction('allow', fromEmails, undefined, destination)
const screenOut = (fromEmails: string[]) => runAction('screenOut', fromEmails)

// Domain-level triage. Screening rules accept an `@domain` value: it covers all future mail from the
// domain and — because the backend's screened-mail lookup uses a JMAP `from` contains-match — moves
// every already-screened message from that domain too. We also clear every visible sender in the
// domain in one go.
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

const runDomainAction = (action: 'allow' | 'screenOut', sender: ScreeningSender) => {
	const domain = domainOf(sender.from_email)
	if (!domain) return
	runAction(action, [`@${domain}`], (s: ScreeningSender) => domainOf(s.from_email) === domain)
}

// A globe, not the verdict's own Check/X: what sets this entry apart from the button it hangs off is
// its reach — the whole @domain rather than this one address. Same pair the phone's overflow uses.
const domainOption = (action: 'allow' | 'screenOut', sender: ScreeningSender) => ({
	label:
		action === 'allow'
			? __('Allow all emails from {0}', [domainOf(sender.from_email)])
			: __('Deny all emails from {0}', [domainOf(sender.from_email)]),
	icon: action === 'allow' ? Globe : GlobeOff,
	onClick: () => runDomainAction(action, sender),
})

// Two label-less groups, so the menu draws a separator: above it the sender is allowed and their
// waiting mail — already read right here — is filed away instead of asking to be triaged again in
// the Inbox; below it the decision widens to everyone at their domain.
// Desktop only (the split buttons this hangs off are), so the keys are worth naming: there is a
// keyboard to press them on, and a menu you had to open to find the action is the place someone
// learns they needn't open it next time. The phone's overflow leaves them out.
const allowOptions = (sender: ScreeningSender) => [
	{
		group: '',
		items: [
			{
				label: __('Allow and Archive ({0})', ['E']),
				icon: Archive,
				onClick: () => allow([sender.from_email], 'archive'),
			},
			{
				label: __('Allow and Move to Trash ({0})', ['Delete']),
				icon: Trash2,
				onClick: () => allow([sender.from_email], 'trash'),
			},
		],
	},
	{ group: '', items: [domainOption('allow', sender)] },
]

const denyOptions = (sender: ScreeningSender) => [domainOption('screenOut', sender)]

// Everything the desktop split-buttons hold, in one menu — the phone's verdict bar carries only the
// two plain answers, so without this the destinations and the domain-wide calls would be reachable
// by keyboard alone. Grouped by verdict, in the order the bar below reads: deny, then allow.
const moreOptions = (sender: ScreeningSender) => [
	// Grouped by reach, matching the desktop allow menu: what happens to this one sender's mail,
	// then the calls that cover everyone at their domain. The divider marks that widening — the two
	// domain rows read as a pair (same phrasing, same globes) and shouldn't be split from each other.
	{
		group: '',
		items: [
			{
				label: __('Allow and Archive'),
				icon: Archive,
				onClick: () => allow([sender.from_email], 'archive'),
			},
			{
				label: __('Allow and Move to Trash'),
				icon: Trash2,
				onClick: () => allow([sender.from_email], 'trash'),
			},
		],
	},
	// A globe, not the bar's tick: these are the only entries reaching past this one sender, and
	// reusing the verdict icons would say nothing about that. Deny is red, which sets it apart
	// without a divider of its own — it is the only row here that shuts someone out.
	{
		group: '',
		items: [
			{
				label: __('Allow all emails from {0}', [domainOf(sender.from_email)]),
				icon: Globe,
				onClick: () => runDomainAction('allow', sender),
			},
			{
				label: __('Deny all emails from {0}', [domainOf(sender.from_email)]),
				icon: GlobeOff,
				theme: 'red',
				onClick: () => runDomainAction('screenOut', sender),
			},
		],
	},
]

// Clear All empties the queue without judging anyone: it moves all screened mail to the inbox but
// creates no Deny/Allow rule, so a mixed queue can't accidentally whitelist spam or block a real sender.
const showClearAll = ref(false)

// Shared by Clear All and the turn-off flow, which is why the success handling lives with each caller.
const moveScreeningToInbox = createResource({
	url: 'suite.mail.api.mail.move_screening_mails_to_inbox',
	makeParams: () => ({ account: store.accountId }),
})

const clearAll = async () => {
	await moveScreeningToInbox.submit()
	senders.data = []
	closeSender()
	showClearAll.value = false
	store.mailboxes.reload()
	raiseToast(__('Unscreened messages moved to Inbox.'))
}

const clearAllOptions = computed(() => ({
	title: __('Move All to Inbox'),
	message: __(
		'Messages from {0} senders will be moved to your Inbox. Future emails from them will still go to the Screener.',
		[String(senders.data?.length ?? 0)],
	),
	actions: [
		{
			label: __('Move to Inbox'),
			variant: 'solid',
			onClick: clearAll,
			loading: moveScreeningToInbox.loading,
		},
	],
}))

// First-visit explainer card. Dismissal is stored per device, not per account — it's education about
// the feature, not account state.
const EXPLAINER_STORAGE_KEY = 'mail-screener-explainer-dismissed'
// localStorage can throw (private browsing, storage disabled); a broken slab
// preference must not take the whole view down with it.
const readExplainerDismissed = () => {
	try {
		return localStorage.getItem(EXPLAINER_STORAGE_KEY) === 'true'
	} catch {
		return false
	}
}
const explainerDismissed = ref(readExplainerDismissed())

const dismissExplainer = () => {
	explainerDismissed.value = true
	try {
		localStorage.setItem(EXPLAINER_STORAGE_KEY, 'true')
	} catch {
		// Storage unavailable — the slab reappears next visit, nothing worse.
	}
}

// Bulk triage over every waiting sender. Allow/Deny reuse the per-sender flow (optimistic clear +
// batched request) but, since they act on everyone at once, go behind a confirm dialog.
const allSenderEmails = () => (senders.data ?? []).map((s: ScreeningSender) => s.from_email)

const showBulkConfirm = ref(false)
const pendingBulkAction = ref<'allow' | 'screenOut' | null>(null)

const allowAll = () => confirmBulk('allow')
const denyAll = () => confirmBulk('screenOut')

const confirmBulk = (action: 'allow' | 'screenOut') => {
	pendingBulkAction.value = action
	showBulkConfirm.value = true
}

const runBulk = () => {
	const action = pendingBulkAction.value
	showBulkConfirm.value = false
	pendingBulkAction.value = null
	if (action) runAction(action, allSenderEmails())
}

const bulkConfirmOptions = computed(() => {
	const count = senders.data?.length ?? 0
	const isAllow = pendingBulkAction.value === 'allow'
	return {
		title: isAllow ? __('Allow All Senders') : __('Deny All Senders'),
		message: isAllow
			? __('{0} senders will be allowed, and their messages moved to your Inbox.', [String(count)])
			: __('{0} senders will be denied, and their messages moved to Junk.', [String(count)]),
		actions: [
			{
				label: isAllow ? __('Allow All') : __('Deny All'),
				variant: 'solid',
				onClick: runBulk,
			},
		],
	}
})

const bulkOptions = computed(() => [
	{ label: __('Allow All'), icon: Check, onClick: allowAll },
	{ label: __('Deny All'), icon: X, onClick: denyAll },
	{ label: __('Move All to Inbox'), icon: Inbox, onClick: () => (showClearAll.value = true) },
])
</script>

