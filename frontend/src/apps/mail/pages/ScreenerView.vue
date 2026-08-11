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
					:class="!isMobile && showReadingPane ? 'w-1/3 border-r' : 'w-full'"
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
							<div class="-mr-2 flex shrink-0 items-center gap-1">
								<Dropdown :options="bulkOptions" placement="bottom-end">
									<Button variant="ghost" class="!px-1.5">
										<template #icon><Ellipsis class="icon" /></template>
									</Button>
								</Dropdown>
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
									<span class="text-ink-gray-8 truncate text-[15px] !font-semibold sm:text-base">
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
								<div class="text-ink-gray-8 truncate text-sm !font-semibold !leading-[1.5]">
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
						'w-2/3': !isMobile && showReadingPane,
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
							<div class="flex shrink-0 gap-2">
								<div class="flex items-center">
									<Button
										variant="outline"
										:label="__('Deny')"
										class="!rounded-r-none"
										@click="screenOut([openSender.from_email])"
									/>
									<AdaptiveDropdown
										:options="domainOptions('screenOut', openSender)"
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
										class="!rounded-r-none"
										@click="allow([openSender.from_email])"
									/>
									<AdaptiveDropdown
										:options="domainOptions('allow', openSender)"
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
									<MailThread
										v-else-if="previewMails?.length"
										class="min-h-0 flex-1"
										readonly
										mailbox=""
										:thread-i-d="openSender.from_email"
										:threads="[]"
										:messages="previewMails"
									/>
								</div>
							</Transition>
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
	Check,
	ChevronDown,
	ChevronLeft,
	CircleHelp,
	Ellipsis,
	Inbox,
	LoaderCircle,
	X,
} from 'lucide-vue-next'
import {
	Breadcrumbs,
	Button,
	Dialog,
	Dropdown,
	Popover,
	createResource,
	usePageMeta,
} from 'frappe-ui'

import { raiseToast, shouldIgnoreKeypress } from '@/apps/mail/utils'
import { isNavigationKey, navigationOffset } from '@/apps/mail/utils/listNavigation'
import { useScreenSize, useSettings, useSwipeNav } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import HeaderActions from '@/apps/mail/components/HeaderActions.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import MailDate from '@/apps/mail/components/MailDate.vue'
import MailThread from '@/apps/mail/components/MailThread.vue'
import MobileTitleHeader from '@/apps/mail/components/mobile/MobileTitleHeader.vue'
import MailThreadSkeleton from '@/apps/mail/components/MailThreadSkeleton.vue'

import type { Mail, MailboxData, ScreeningSender } from '@/apps/mail/types'

const store = userStore()
const router = useRouter()
const { isMobile } = useScreenSize()
const { openSettings } = useSettings()

const showReadingPane = computed(() => !!store.userResource?.data?.show_reading_pane)

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

const selectSender = (sender: ScreeningSender) => {
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
	openSender.value = null
}

const senders = createResource({
	url: 'suite.mail.api.mail.get_screening_senders',
	makeParams: () => ({ account: store.accountId }),
	auto: true,
})

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
		selectSender(next)
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

// Once a mail is open, ↑/↓ (or k/j) step to the previous/next sender and Esc closes it. Else inert.
const handleKeydown = (e: KeyboardEvent) => {
	if (!openSender.value || shouldIgnoreKeypress(e)) return
	const key = e.key.toLowerCase()

	if (key === 'escape') {
		e.preventDefault()
		closeSender()
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

	selectSender(next)
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

const allowResource = createResource({
	url: 'suite.mail.api.mail.allow_screening_senders',
	makeParams: ({ from_emails }: { from_emails: string[] }) => ({
		account: store.accountId,
		from_emails,
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
const pending = { allow: new Set<string>(), screenOut: new Set<string>() }
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushChain: Promise<void> = Promise.resolve()

const flushScreening = () => {
	flushTimer = null
	const allowEmails = [...pending.allow]
	const screenOutEmails = [...pending.screenOut]
	pending.allow.clear()
	pending.screenOut.clear()
	if (!allowEmails.length && !screenOutEmails.length) return

	// Chain onto the previous flush so requests never overlap (overlapping rebuilds are the bug).
	flushChain = flushChain.then(async () => {
		// Submit each action independently so one failing doesn't skip the other — a burst can mix
		// allow and screen-out across different senders, and all were already optimistically removed.
		let submitted = false
		let firstError: unknown
		if (allowEmails.length) {
			try {
				await allowResource.submit({ from_emails: allowEmails })
				submitted = true
			} catch (error) {
				firstError ??= error
			}
		}
		if (screenOutEmails.length) {
			try {
				await screenOutResource.submit({ from_emails: screenOutEmails })
				submitted = true
			} catch (error) {
				firstError ??= error
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

const queueScreening = (action: 'allow' | 'screenOut', fromEmails: string[]) => {
	const other = action === 'allow' ? pending.screenOut : pending.allow
	for (const email of fromEmails) {
		other.delete(email)
		pending[action].add(email)
	}
	if (!flushTimer) flushTimer = setTimeout(flushScreening, SCREEN_FLUSH_DELAY)
}

// `matchSender` decides which rows this action clears from the list; by default the senders whose
// address is in `fromEmails`, but a domain action clears everyone in the domain (see runDomainAction).
const runAction = (
	action: 'allow' | 'screenOut',
	fromEmails: string[],
	matchSender: (s: ScreeningSender) => boolean = (s) => fromEmails.includes(s.from_email),
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
	// interactive. The row leaving is the only success feedback (no toast); only failures are surfaced
	// — with a resync to bring the rows back.
	senders.data = list.filter((s: ScreeningSender) => !matchSender(s))

	// Advance to the next sender (or close the preview if there's nothing below).
	if (actingOnOpen) {
		if (nextSender) selectSender(nextSender)
		else closeSender()
	}

	queueScreening(action, fromEmails)
}

const allow = (fromEmails: string[]) => runAction('allow', fromEmails)
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

const domainOptions = (action: 'allow' | 'screenOut', sender: ScreeningSender) => [
	{
		label:
			action === 'allow'
				? __('Allow all emails from {0}', [domainOf(sender.from_email)])
				: __('Deny all emails from {0}', [domainOf(sender.from_email)]),
		icon: action === 'allow' ? Check : X,
		onClick: () => runDomainAction(action, sender),
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

