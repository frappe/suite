<template>
	<div v-if="threadID" class="relative flex h-full flex-col overflow-hidden">
		<ThreadHeader
			v-if="!readonly"
			:threads
			:thread
			:can-go-next="canGoNext"
			@set-flagged="(ids: string[], flagged: boolean) => emit('setFlagged', ids, flagged)"
			@set-seen="setThreadSeen"
			@move-thread="(moveToMailbox: string) => emit('moveThread', moveToMailbox)"
			@add-thread-to-mailbox="(mailboxId: string) => emit('addThreadToMailbox', mailboxId)"
			@remove-thread-from-mailbox="
				(mailboxId: string) => emit('removeThreadFromMailbox', mailboxId)
			"
			@set-spam-status="(spam: boolean) => emit('setSpamStatus', spam)"
			@delete-thread="emit('deleteThread')"
			@prev-thread="emit('prevThread')"
			@next-thread="emit('nextThread')"
		/>
		<!-- The swipe slide (`slide` prop) pages only the thread-specific part — subject,
		     messages, reply bar — while the toolbar above stays put. Keyed per thread on
		     mobile: the outgoing thread's frozen DOM slides away as the incoming one
		     slides in. Desktop keys statically, so switching threads never remounts. -->
		<div class="relative min-h-0 flex-1 overflow-hidden">
		<Transition :name="slide || ''" @after-enter="emit('slideDone')">
		<div :key="isMobile ? threadID : 'thread'" class="flex h-full flex-col">
		<!-- Mobile: the subject is part of the fixed chrome — scrolling starts below it,
		     and its border is the separator content passes under. -->
		<div v-if="isMobile && thread?.length" class="shrink-0 border-b px-3.5 pb-3.5 pt-1.5">
			<!-- !leading-7: subjects wrap, and both text-xl-semibold (line-height 1.15
			     baked in) and the global body.mail-app h2 rule outrank a plain leading-*
			     utility — wrapped lines sat nearly touching. -->
			<h2 class="text-xl-semibold !leading-7">
				{{ thread[0].subject || __('[No subject]') }}
			</h2>
		</div>
		<div ref="threadContainer" class="flex-1 overflow-y-auto">

			<!-- The composer window floats over the app, so while one is up the thread keeps a
			     little room under its last message — enough to scroll clear of a minimised bar
			     rather than ending beneath it. Not reserved otherwise, or every thread would
			     end in a gap explaining nothing. -->
			<div
				class="sm:space-y-4 sm:px-5 sm:pt-6"
				:class="{
					'pb-16': isMobile && !thread?.at(-1)?.draft,
					'sm:pb-24': isComposeWindowOpen(),
					'sm:pb-6': !isComposeWindowOpen(),
				}"
			>
				<template v-for="group in mailsByDay" :key="group.date">
					<ThreadDivider
						v-if="shouldShowDateDivider(group.mails)"
						:message="getFormattedDate(group.date)"
					/>
					<template v-for="mail in group.mails" :key="mail.name">
						<ThreadDivider
							v-if="shouldShowUnseenMarker(mail.id)"
							class="!text-ink-blue-6 [&_.border-t]:border-[var(--outline-blue-3)] [&_span:not(.border-t)]:border-[var(--outline-blue-3)]"
							:message="unseenMessage"
						/>

						<button
							v-if="mail.name === firstMailOfCollapsedGroup"
							class="w-full cursor-pointer transition-colors"
							@click="resetCollapsedGroup"
						>
							<ThreadDivider
								:message="
									__('{0} more messages', [String(collapsedMailNames.size)])
								"
								class="hover:text-ink-gray-8"
							/>
						</button>
						<!-- A draft that is popped out drops out of the thread entirely: it is being
						     written in the composer window, and it must be the card that goes, not
						     just the editor inside it — the wrapper carries the draft's own border,
						     padding and shadow, so hiding only its contents left an empty white
						     card sitting in the thread. -->
						<div
							v-if="!collapsedMailNames.has(mail.name) && !isPoppedOut(mail)"
							:data-mail-name="mail.name"
							:class="{
								'px-3.5 py-5': isMobile,
								'max-sm:border-b':
									(thread.length > 1 || mail.draft) &&
									mail.name !== mailBeforeCollapsedGroup &&
									mail.name !== mailBeforeUnseenMarker,
								'sm:rounded-xl sm:p-5': thread.length > 1 || mail.draft,
								'sm:border':
									(thread.length > 1 && !mail.draft) ||
									(mail.draft && dataTheme === 'dark'),
								'cursor-pointer': isCollapsed(mail),
								'sm:shadow-md': mail.draft && dataTheme === 'light',
							}"
							@click="mail.collapsed = false"
						>
							<ComposeMailEditor
								v-if="mail.draft && !isMobile"
								v-model="mail.show"
								:reload-mails="reload"
								:mail-details="draftMails[mail.name]"
								:is-in-thread="true"
								@discard-mail="discardLocalDraft(mail.name)"
								@reply="reply(getSourceMail(mail.name))"
								@reply-all="replyAll(getSourceMail(mail.name))"
								@forward="forward(getSourceMail(mail.name))"
								@pop-out="
									(mailDetails: ComposeMailData) => popOutDraft(mailDetails)
								"
							/>

							<template v-else-if="!mail.name.startsWith('draft')">
								<div
									v-if="isMobile && !isCollapsed(mail)"
									class="flex items-center justify-between pb-2"
									@click.stop="mail.collapsed = !mail.collapsed"
								>
									<div class="flex items-center space-x-2">
										<Badge
											v-if="mail.draft"
											:label="__('Draft')"
											theme="red"
											class="w-fit"
										/>
										<MailDate :datetime="mail.received_at" />
									</div>
									<MailActions
										v-if="!readonly"
										:mailbox
										:mail
										:draft-mail="draftMails[mail.name]"
										:is-collapsed="isCollapsed(mail)"
										:show-reply-all="showReplyAll(mail)"
										:pop-out-draft
										:reply
										:reply-all
										:forward
										:reload-mails="handleReload"
										:thread="thread"
										@set-flagged="
											(id: string, flagged: boolean) =>
												emit('setFlagged', [id], flagged)
										"
										@sync-unseen="handleSyncUnseen"
										@move-mail="(m: Mail, target: string) => emit('moveMail', m, target)"
										@mark-mail-spam="(m: Mail, spam: boolean) => emit('markMailSpam', m, spam)"
										@delete-mail="(m: Mail) => emit('deleteMail', m)"
									/>
								</div>
								<!-- An expanded mail always needs the gap between header and body —
								     keying it on the preview alone left image-only mails (empty text
								     preview) flush. Collapsed rows keep the preview-keyed padding. -->
								<div
									class="flex items-center space-x-3"
									:class="{
										'cursor-pointer': mail !== lastMessage,
										'pb-6': mail.preview || !isCollapsed(mail),
									}"
									@click.stop="mail.collapsed = !mail.collapsed"
								>
									<Avatar
										:label="getSenderInitial(mail)"
										:image="mail.user_image"
										size="xl"
									/>
									<div class="flex flex-1 justify-between truncate text-sm">
										<div class="mr-3 flex flex-col space-y-1 truncate">
											<div class="flex items-center space-x-1.5">
												<span
													class="truncate text-[15px] !font-semibold sm:text-base"
												>
													{{ mail.from_name || mail.from_email }}
												</span>
												<!-- leading-4: truncate is overflow-hidden, and the preset's 1.15 puts 13px
												     text in a 14.95px box while Inter's glyph box wants ~15.7 — so the
												     descenders of a g or a p were shaved off. 16px still sits under the
												     sender name beside it, so the row does not grow. -->
												<span
													v-if="!isMobile"
													class="text-ink-gray-5 truncate leading-4"
												>
													<span>&lt;</span>
													<Tooltip :text="__('Filter messages from this sender')">
														<span
															class="cursor-pointer hover:underline"
															@click.stop="filterBySender(mail.from_email)"
														>{{ mail.from_email }}</span>
													</Tooltip>
													<span>&gt;</span>
												</span>
												<template
													v-if="!(isCollapsed(mail) || mail.draft)"
												>
													<ChevronDown
														v-if="isMobile"
														class="text-ink-gray-6 h-3.5 w-3.5 rounded-sm transition-transform duration-200"
														:class="{
															'rotate-180':
																showMailDetails === mail.name,
														}"
														@click.stop="
															showMailDetails =
																showMailDetails === mail.name
																	? undefined
																	: mail.name
														"
													/>
													<MailDetailsPopover v-else :mail />
												</template>
											</div>
											<!-- Same 13px truncate, same shaved descenders. -->
											<div class="truncate leading-4">
												{{ getFormattedRecipients(mail.recipients) }}
											</div>
										</div>
										<div class="flex items-center space-x-1 self-start">
											<MailDate
												v-if="!isMobile || isCollapsed(mail)"
												:datetime="mail.received_at"
											/>
											<MailActions
												v-if="!isMobile && !readonly"
												:mailbox
												:mail
												:is-collapsed="isCollapsed(mail)"
												:show-reply-all="showReplyAll(mail)"
												:pop-out-draft
												:reply
												:reply-all
												:forward
												:reload-mails="handleReload"
												:thread="thread"
												@set-flagged="
													(id: string, flagged: boolean) =>
														emit('setFlagged', [id], flagged)
												"
												@sync-unseen="handleSyncUnseen"
												@move-mail="(m: Mail, target: string) => emit('moveMail', m, target)"
												@mark-mail-spam="(m: Mail, spam: boolean) => emit('markMailSpam', m, spam)"
												@delete-mail="(m: Mail) => emit('deleteMail', m)"
											/>
										</div>
									</div>
								</div>

								<MailDetails
									v-if="!isCollapsed(mail) && showMailDetails === mail.name"
									:mail
									class="mb-4"
								/>

								<div v-show="isCollapsed(mail)" class="truncate text-base">
									{{ mail.preview }}
								</div>

								<div v-show="!isCollapsed(mail)">
									<Alert
										v-if="!readonly && isSenderBlocked(mail.from_email)"
										:title="__('This sender is blocked')"
										class="mb-4"
										:dismissable="false"
									>
										<template #description>
											<p class="text-ink-gray-6 prose-sm">
												{{
													__('{0} is currently on your', [
														mail.from_name || mail.from_email,
													])
												}}
												<button
													type="button"
													class="hover:text-ink-gray-8 underline"
													@click="openSettings(__('Block List'))"
												>
													{{ __('block list') }}</button
												>{{
													__(
														". You won't receive new messages from this source until you unblock them.",
													)
												}}
											</p>
										</template>
										<template #footer>
											<div class="col-span-full">
												<Button
													:label="__('Unblock')"
													variant="outline"
													@click="
														unblockEmailAddress.submit(mail.from_email)
													"
												/>
											</div>
										</template>
									</Alert>
									<CalendarInviteBanner
										v-if="!readonly && !isCollapsed(mail) && icsAttachment(mail)"
										:key="`invite-${mail.name}`"
										:attachment="icsAttachment(mail)"
										:account="scopeAccountId"
									/>
									<DeliveryStatusBanner
										v-if="showsDsnCard(mail)"
										:key="`dsn-${mail.name}`"
										:blob-id="mail.dsn_blob_id!"
										:account="scopeAccountId"
										@loaded="dsnCardRendered[mail.name] = $event"
									/>
									<template v-if="!dsnReplacesBody(mail)">
										<EmailContent
											v-if="hasHtmlContent(mail.html_body)"
											:content="mail.html_body"
											:block-images="shouldBlockImages(mail)"
											:can-trust="!readonly"
											@trust="trustSender.submit(mail.from_email)"
										/>

										<!-- font-sans is the system stack, not Inter: the preset leaves
										     fontFamily.sans alone and puts InterVar on <html> instead. So this is
										     deliberately off the variable font — and text-base's 420 then has no
										     face to land on, which CSS resolves upward to the system Medium,
										     rendering the body bolder than everything around it. font-normal pins
										     it to Regular. -->
										<LinkifiedText
											v-else
											:text="getPlainTextBody(mail)"
											class="pt-4 font-sans !font-normal text-base !leading-5 sm:text-sm"
										/>
									</template>

									<div v-if="filteredAttachments(mail).length" class="mt-8">
										<div
											v-if="zippableAttachments(mail).length > 1"
											class="text-ink-gray-5 mb-3 flex items-center gap-1.5 text-sm"
										>
											<span>
												{{
													__('{0} attachments', [
														String(filteredAttachments(mail).length),
													])
												}}
											</span>
											<span aria-hidden="true">·</span>
											<button
												class="hover:text-ink-gray-8 disabled:opacity-70"
												:disabled="downloadingZipMail === mail.name"
												:title="__('Download all')"
												@click.stop.prevent="
													downloadAttachmentsAsZip(mail)
												"
											>
												<LoaderCircle
													v-if="downloadingZipMail === mail.name"
													class="h-3.5 w-3.5 animate-spin"
												/>
												<Download v-else class="h-3.5 w-3.5" />
											</button>
										</div>
										<div class="flex flex-wrap">
											<AttachmentCapsule
												v-for="(attachment, idx) in filteredAttachments(
													mail,
												)"
												:key="idx"
												:file-name="attachment.filename"
												:blob-i-d="attachment.blob_id"
												:type="attachment.type"
												:account="scopeAccountId"
												class="mb-2 mr-2"
												@click.stop.prevent="
													openAttachment(
														filteredAttachments(mail),
														Number(idx),
													)
												"
											/>
										</div>
									</div>
								</div>
							</template>
						</div>

						<!-- Stands in for the card while the reply is being written in the composer
						     window, so the conversation still shows there is a draft in it — and offers
						     the way back. Same border, radius and horizontal padding as the card it
						     replaces, so it keeps the thread's rhythm and its text lines up with the
						     messages above; only the vertical padding is slimmer, because it is a line
						     about a message rather than a message. v-else-if, so it appears only where
						     the card was withheld; the collapsed test tells that reason from this one. -->
						<div
							v-else-if="!collapsedMailNames.has(mail.name)"
							class="text-ink-gray-8 rounded-xl border px-5 py-3 text-sm"
						>
							{{ __('This draft is open in another window.') }}
							<button
								class="text-ink-blue-6 cursor-pointer font-medium hover:underline"
								@click="showDraftInThread()"
							>{{ __('Edit here instead') }}</button>.
						</div>
					</template>
				</template>

				<div
					v-if="!readonly && thread.length && !thread?.at(-1)?.draft"
					class="flex"
					:class="
						isMobile
							? 'bg-surface-base absolute bottom-0 left-0 right-0 z-20 items-stretch border-t'
							: 'items-center space-x-2'
					"
				>
					<Button
						v-for="action in replyForwardActions"
						:key="action.label"
						:icon-left="action.icon"
						:label="action.label"
						:tooltip="action.tooltip"
						:variant="isMobile ? 'ghost' : 'outline'"
						:class="{ '!h-16 flex-1 rounded-none': isMobile }"
						@click="action.onClick"
					/>
				</div>
			</div>
		</div>
		</div>
		</Transition>
		</div>
		<SendMail
			v-if="focusedDraft"
			ref="composeWindow"
			v-model="showSendModal"
			:mail-details="draftMails[focusedDraft]"
			@reload-mails="reload"
			@discard-mail="discardLocalDraft(focusedDraft)"
			@discard-started="dropPoppedOutDraft()"
		/>
		<AttachmentViewer
			v-model="showAttachmentViewer"
			:attachments="attachments"
			:initial-index="attachmentIndex"
			:account="scopeAccountId"
		/>
	</div>

	<div v-else class="h-full overflow-hidden p-5">
		<div
			class="bg-surface-gray-1 flex h-full items-center justify-center rounded-md"
		>
			<div class="flex flex-col items-center space-y-3">
				<NoMails class="text-ink-gray-2 h-16 w-16" />
				<p class="text-ink-gray-4">
					{{ __('Select an email to view the thread.') }}
				</p>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import {
	computed,
	inject,
	nextTick,
	onMounted,
	onUnmounted,
	reactive,
	ref,
	useTemplateRef,
	watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, Download, Forward, LoaderCircle, Reply, ReplyAll } from 'lucide-vue-next'
import { Alert, Avatar, Badge, Button, Tooltip, createResource } from 'frappe-ui'

import { getAttachmentsZipUrl } from '@/apps/mail/resources'
import {
	decodeHtmlEntities,
	downloadUrlAsFile,
	escapeHtml,
	extractQuotedContent,
	getFormattedDate,
	getFormattedRecipients,
	getGroupedRecipients,
	hasHtmlContent,
	matchesScreenedValue,
	raiseToast,
	shouldIgnoreKeypress,
} from '@/apps/mail/utils'
import { getSenderInitial } from '@/apps/mail/utils/participants'
import { useFilterBySender, useScreenSize, useSettings, useTheme } from '@/apps/mail/utils/composables'
import { provideAccountScope } from '@/apps/mail/utils/accountScope'
import { userStore } from '@/apps/mail/stores/user'
import AttachmentCapsule from '@/apps/mail/components/AttachmentCapsule.vue'
import AttachmentViewer from '@/apps/mail/components/AttachmentViewer.vue'
import CalendarInviteBanner from '@/apps/mail/components/CalendarInviteBanner.vue'
import ComposeMailEditor from '@/apps/mail/components/ComposeMailEditor.vue'
import DeliveryStatusBanner from '@/apps/mail/components/DeliveryStatusBanner.vue'
import EmailContent from '@/apps/mail/components/EmailContent.vue'
import NoMails from '@/apps/mail/components/Icons/NoMails.vue'
import LinkifiedText from '@/components/LinkifiedText.vue'
import { openComposePage } from '@/apps/mail/composables/composeHandoff'
import MailActions from '@/apps/mail/components/MailActions.vue'
import MailDate from '@/apps/mail/components/MailDate.vue'
import MailDetails from '@/apps/mail/components/MailDetails.vue'
import MailDetailsPopover from '@/apps/mail/components/MailDetailsPopover.vue'
import {
	closeComposeWindow,
	composeWindowDraft,
	isComposeWindowOpen,
} from '@/apps/mail/composables/useComposeWindow'
import SendMail from '@/apps/mail/components/SendMail.vue'
import ThreadDivider from '@/apps/mail/components/ThreadDivider.vue'
import ThreadHeader from '@/apps/mail/components/ThreadHeader.vue'

import type {
	Attachment,
	ComposeMailData,
	Identity,
	Mail,
	Mailbox,
	MailboxData,
	ScreenedAddress,
} from '@/apps/mail/types'

const {
	mailbox,
	threadID,
	threads,
	messages,
	canGoNext,
	readonly,
	// Explicit default: Vue casts an absent Boolean prop to `false`, so this cannot be left to a
	// `?? !readonly` fallback — every caller that didn't pass it would silently stop marking read.
	marksSeen = true,
	slide,
	account,
} =
	defineProps<{
		mailbox: string
		threadID?: string
		threads: string[]
		messages?: Mail[]
		canGoNext?: boolean
		// The thread's owning account, when it isn't the active one (All Inboxes opens
		// cross-account threads without switching): the pane and everything inside it —
		// folder menus, reply identities, screened-sender banners — act as this account
		// via the provided scope (see utils/accountScope).
		account?: string
		// Read-only thread (e.g. the Screener): renders the messages but hides every action — the thread
		// toolbar, per-message actions, the block banner and the reply/forward bar — and never marks read.
		readonly?: boolean
		/** Marks the conversation seen on open. On by default; a view that only previews can opt out. */
		marksSeen?: boolean
		// Transition name for the mobile swipe paging ('page-next' / 'page-prev', styled in
		// MailLayout); the owner arms it per swipe and clears it on slideDone, so other thread
		// changes swap instantly.
		slide?: string
	}>()

const emit = defineEmits([
	'reloadMails',
	'setSpamStatus',
	'archiveThread',
	'deleteThread',
	'setSeen',
	'setFlagged',
	'moveThread',
	'addThreadToMailbox',
	'removeThreadFromMailbox',
	'prevThread',
	'nextThread',
	'syncUnseen',
	'moveMail',
	'markMailSpam',
	'deleteMail',
	'slideDone',
])

const { isMobile } = useScreenSize()
const { openSettings } = useSettings()
const { filterBySender } = useFilterBySender()
const dayjs = inject('$dayjs')
const user = inject('$user')
// The pane acts as the thread's owning account (the active one unless the `account`
// prop says otherwise) — provided so ThreadHeader's folder menus and the reply
// editors below resolve the same account.
const scope = provideAccountScope(() => account)
const { accountId: scopeAccountId, identities, screenedAddresses, mailboxIds } = scope
// Global screening rules are admin-managed and the same whichever account you are reading, so
// they come from the store rather than the pane's scope.
const { globalScreenedAddresses } = userStore()

// A sender is "blocked" when screened with the Reject action (their mail is discarded) — either by their
// exact address or by an accepted/blocked '@domain' entry covering them.
const isSenderBlocked = (email: string) =>
	!!screenedAddresses.value.data?.some(
		(a: ScreenedAddress) => a.action === 'Reject' && matchesScreenedValue(email, a.email),
	)

// Trusted senders — you, or anyone you've accepted — load images normally. For everyone else, the
// account's "Block Remote Images" setting withholds remote images (read-tracking pixels) until you opt in.
const blockRemoteImagesEnabled = computed(() => scope.account.value?.block_remote_images ?? true)
// The screening rules in effect for the account: the admin-managed global rules overlaid with the
// account's own, the account's rule winning when both screen the same address or domain — mirroring
// the backend's `get_effective_screened_email_addresses`, which the automation sieve is built from.
// Read through the pane's scope, so a thread from another account is judged by that account's rules.
const effectiveScreenedAddresses = computed(() => {
	const merged = new Map<string, ScreenedAddress>()
	for (const a of globalScreenedAddresses.data ?? []) merged.set(a.email.toLowerCase(), a)
	for (const a of screenedAddresses.value.data ?? []) merged.set(a.email.toLowerCase(), a)
	return [...merged.values()]
})
const isScreenedIn = (email: string) =>
	!!identities.value.data?.some((i: Identity) => i.email === email) ||
	effectiveScreenedAddresses.value.some(
		(a: ScreenedAddress) => a.action === 'Accepted' && matchesScreenedValue(email, a.email),
	)
const shouldBlockImages = (mail: { from_email: string }) =>
	blockRemoteImagesEnabled.value && !isScreenedIn(mail.from_email)

const { dataTheme } = useTheme()

const route = useRoute()
const router = useRouter()

const threadContainerRef = useTemplateRef('threadContainer')

const draftMails = reactive<{ [key: string]: ComposeMailData }>({})

const mailsByDay = computed(() => {
	const groups: { date: string; mails: Mail[] }[] = []
	for (const mail of thread.value || []) {
		const day = dayjs(mail.received_at).format('YYYY-MM-DD')
		const last = groups.at(-1)
		if (last && last.date === day) last.mails.push(mail)
		else groups.push({ date: day, mails: [mail] })
	}
	return groups
})

const shouldShowDateDivider = (mails: Mail[]) =>
	!isMobile.value &&
	mailsByDay.value.length > 1 &&
	user.data.group_messages_by === 'Day' &&
	!mails.every((m) => collapsedMailNames.value.has(m.name))

const collapsedMailNames = computed(() => {
	if (!firstMailOfCollapsedGroup.value) return new Set<string>()
	const lastMailName = thread.value?.at(-1)?.name
	const seenMails = (thread.value || []).filter(
		(m) => m.seen && !m.name.startsWith('draft') && m.name !== lastMailName,
	)
	if (seenMails.length < 4) return new Set<string>()
	return new Set(seenMails.slice(1, -1).map((m) => m.name))
})

const mailBeforeUnseenMarker = computed(() => {
	if (!firstUnseenMail.value) return null
	const data = thread.value || []
	const idx = data.findIndex((m) => m.id === firstUnseenMail.value)
	return idx > 0 ? data[idx - 1].name : null
})

const isSomeSeen = computed(() => (thread.value || []).some((m) => m.seen))
const unseenCount = computed(() => (thread.value || []).filter((m) => !m.seen && !m.draft).length)
const firstUnseenMail = computed(() => thread.value?.find((m) => !m.seen && !m.draft)?.id)

const unseenMessage = computed(() =>
	unseenCount.value === 1
		? __('1 new message')
		: __('{0} new messages', [String(unseenCount.value)]),
)

const shouldShowUnseenMarker = (id: string) =>
	isSomeSeen.value && firstUnseenMail.value && id == firstUnseenMail.value

// Bail to the list the thread was opened from — the merged All Inboxes list on
// its thread route, the mailbox list otherwise.
const goToMailbox = () =>
	router.push(
		route.name === 'mail-all-inboxes-mail'
			? { name: 'mail-all-inboxes', query: route.query }
			: { name: 'mail-mailbox', params: { mailbox }, query: route.query },
	)

// The thread's messages normally arrive from the parent (loaded via `get_threads`). When the open
// thread isn't in that list (e.g. a search result, or one on another page), fall back to fetching it
// directly via `get_thread`.
const thread = ref<Mail[]>([])

const threadFallback = createResource({
	url: 'suite.mail.api.mail.get_thread',
	makeParams: () => ({ account: scopeAccountId.value, thread_id: threadID }),
	onSuccess: (mails: Mail[]) => {
		// Thread no longer exists (e.g. deleted) — bail to the mailbox instead of a blank page.
		if (!mails?.length) {
			goToMailbox()
			emit('reloadMails')
			return
		}
		loadThread()
	},
	onError: () => goToMailbox(),
})

// Mails optimistically removed from the pane (per-message trash/junk/delete) whose request is still in
// flight. The server still returns them for a moment, so any re-derive — our own reload, the 30s poll,
// or the new-mail socket — would otherwise re-add them here. Cleared when the open thread changes.
const removedMailIds = new Set<string>()

const transformThreadMails = (mails: Mail[]) =>
	mails
		// Read-only views (the Screener) pass an explicit message list that isn't scoped to a mailbox.
		.filter((mail) => readonly || (!removedMailIds.has(mail.id) && filterRelevantMails(mail)))
		.map((mail) => ({
			...mail,
			groupedRecipients: getGroupedRecipients(mail.recipients, false),
			collapsed: !!mail.seen,
			show: true,
		}))

// Messages from the list when present, otherwise the directly-fetched fallback (matched to the
// current thread so a stale fetch from a previously opened thread is ignored).
const sourceMessages = (): Mail[] | undefined => {
	if (messages?.length) return messages
	const fetched = threadFallback.data as Mail[] | undefined
	return fetched?.[0]?.thread_id === threadID ? fetched : undefined
}

const loadThread = () => {
	if (!threadID) return

	const source = sourceMessages()
	if (!source?.length) {
		// Not in the list — fetch the thread directly.
		if (!messages?.length && !threadFallback.loading) threadFallback.reload()
		return
	}

	const data = transformThreadMails(source)

	if (!data.length) {
		goToMailbox()
		emit('reloadMails')
		return
	}

	thread.value = data
	setCollapsedGroup(data)

	// Opening a draft from the list puts it in the thread, so a composer window still holding that
	// same draft would be a second editor on it — two copies saving over each other, which is how
	// the pair in the screenshot came to disagree. The window gives it up; the thread has it now.
	// Skipped while the window is this thread's own pop-out, or reloading would shut the window the
	// reader is typing in. Asked of the rows being loaded rather than of `showSendModal` alone, which
	// says only that a window was opened from this pane at some point and stays true across a move to
	// another conversation.
	const held = composeWindowDraft()
	if (held && data.some((mail: Mail) => mail.id === held) && !data.some(isPoppedOut))
		closeComposeWindow()

	data.forEach((mail) => {
		if (mail.draft) {
			mail.groupedRecipients = getGroupedRecipients(mail.recipients, false)
			populateDraftMails(mail)
		}
	})

	// Opening a thread marks every message in the whole conversation read — including copies in other
	// mailboxes (e.g. Sent) that aren't shown in this view. The Screener included: reading there is
	// still reading, and leaving it unread left the "waiting to be screened" dot burning after you had
	// looked and simply not decided yet.
	if (marksSeen && source.some((mail) => !mail.seen)) setThreadSeen(true)
}

// Mark the whole conversation seen/unseen — every message across all mailboxes, not just the ones
// shown in this view — so the seen state stays consistent (opening reads all; Mark as Unread unreads
// all). Persisted via the parent (list + server) WITHOUT mutating the displayed messages, so the
// "unread from here" marker survives reopening. Works for list and get_thread-fallback threads alike.
const setThreadSeen = (seen: boolean) => {
	const ids = (sourceMessages() ?? thread.value).map((mail) => mail.id)
	emit('setSeen', seen, ids)
}

// "Mark Unread from Here": mark the given messages unseen in the displayed list and the fallback
// cache, so the unread-from-here marker appears immediately and survives reopening a fallback thread
// (whose source is the cache, not the parent's list data).
const handleSyncUnseen = (ids: string[]) => {
	const markUnseen = (mail: Mail) => {
		if (ids.includes(mail.id)) mail.seen = 0
	}
	thread.value.forEach(markUnseen)
	;(threadFallback.data as Mail[] | undefined)?.forEach(markUnseen)
	emit('syncUnseen', ids)
}

// A reply that arrives while the thread is open (picked up by a background list reload) is appended
// in place. Re-deriving would clobber unsaved inline drafts, so only the genuinely new messages are
// added — before any trailing draft so the in-progress reply stays at the bottom.
const syncWithSource = () => {
	const source = sourceMessages()
	if (!source?.length) return

	// Refresh existing mails' mailbox membership from the list (e.g. after a move/undo), in place so
	// unsaved inline drafts and collapse state survive.
	const sourceById = new Map(source.map((mail) => [mail.id, mail]))
	thread.value.forEach((mail) => {
		const fresh = sourceById.get(mail.id)
		if (fresh) mail.mailboxes = fresh.mailboxes
	})

	// Append any newly-arrived messages, before a trailing draft. Drafts are excluded: the only draft
	// that belongs in an open thread is the one being composed locally (tracked as a `draft:` item whose
	// saved id isn't known here), so a draft returning from a background reload would otherwise be
	// mistaken for a new message and spawn a duplicate, blank compose editor.
	const existing = new Set(thread.value.map((mail) => mail.id))
	const additions = transformThreadMails(source).filter(
		(mail) => !existing.has(mail.id) && !mail.draft,
	)
	if (!additions.length) return

	const draftIndex = thread.value.findIndex((mail) => mail.draft)
	if (draftIndex === -1) thread.value.push(...additions)
	else thread.value.splice(draftIndex, 0, ...additions)
	setCollapsedGroup(thread.value)
}

const firstMailOfCollapsedGroup = ref<string | null>(null)
const mailBeforeCollapsedGroup = ref<string | null>(null)

const resetCollapsedGroup = () => {
	firstMailOfCollapsedGroup.value = null
	mailBeforeCollapsedGroup.value = null
}

const setCollapsedGroup = (data: Mail[]) => {
	const lastMailName = data.at(-1)?.name
	const seenMails = data.filter((m) => m.seen && m.name !== lastMailName)
	if (seenMails.length < 4) {
		resetCollapsedGroup()
		return
	}

	firstMailOfCollapsedGroup.value = seenMails[1]?.name ?? null
	const triggerIdx = data.findIndex((m) => m.name === firstMailOfCollapsedGroup.value)
	mailBeforeCollapsedGroup.value = triggerIdx > 0 ? data[triggerIdx - 1].name : null
}

const filterRelevantMails = (mail: Mail) => {
	if (mailbox === 'search') return true

	const mailboxes = mail.mailboxes.map((m) => m.mailbox_id)
	const trash = mailboxIds.value.trash
	if (mailbox === trash) return mailboxes.includes(trash)

	if (mailbox === mailboxIds.value.junk) return !!mail.junk

	return !mailboxes.includes(trash) && !mail.junk
}

// Explicit refresh: ask the parent to reload `get_threads`, then re-derive once the `messages` prop
// updates (tracked by `forceReload`). Background list reloads must NOT re-derive so that unsaved
// inline drafts survive — they only re-derive when the open thread has no data yet.
let forceReload = false

const reload = () => {
	if (!threadID) return
	// A directly-fetched thread isn't in the list, so refresh it in place.
	if (!messages?.length) return threadFallback.reload()
	forceReload = true
	emit('reloadMails')
}

watch(
	() => threadID,
	() => {
		resetCollapsedGroup()
		removedMailIds.clear()
		thread.value = []
		loadThread()
	},
)

watch(
	() => messages,
	() => {
		if (forceReload || !thread.value.length) {
			forceReload = false
			loadThread()
			return
		}
		// Otherwise keep unsaved drafts but sync existing mails and pull in any newly-arrived ones.
		syncWithSource()
	},
)

onMounted(() => loadThread())

const unblockEmailAddress = createResource({
	url: 'suite.mail.api.mail.unscreen_email_addresses',
	makeParams: (email) => ({ account: scopeAccountId.value, emails: [email] }),
	onSuccess: () => {
		raiseToast(__('Sender unblocked.'))
		screenedAddresses.value.reload()
	},
})

// Trusting a sender accepts them (screened in), so their remote images load now and going forward.
const trustSender = createResource({
	url: 'suite.mail.api.mail.screen_email_addresses',
	makeParams: (email: string) => ({
		account: scopeAccountId.value,
		emails: [email],
		action: 'Accepted',
	}),
	onSuccess: () => {
		raiseToast(__('Sender marked as trusted.'))
		screenedAddresses.value.reload()
	},
})

const handleReload = (isUndo = false) => {
	if (thread.value.length == 1) {
		emit('reloadMails')
		if (!isUndo) return goToMailbox()
	}
	reload()
}

const replyForwardActions = computed(() =>
	[
		{
			label: __('Reply'),
			tooltip: __('Reply (R)'),
			onClick: () => reply(thread.value.at(-1)),
			icon: Reply,
		},
		{
			label: __('Reply All'),
			tooltip: __('Reply All (Shift+R)'),
			onClick: () => replyAll(thread.value.at(-1)),
			icon: ReplyAll,
			condition: showReplyAll(thread.value.at(-1)),
		},
		{
			label: __('Forward'),
			tooltip: __('Forward (F)'),
			onClick: () => forward(thread.value.at(-1)),
			icon: Forward,
		},
	].filter((action) => action.condition !== false),
)

const showMailDetails = ref<string>()

const filteredAttachments = (mail: Mail) =>
	mail.attachments.filter(
		(a: Attachment) => a.disposition === 'attachment' || !a.type.startsWith('image/'),
	)

// A bounce (DSN) message renders as a friendly card built from its message/delivery-status
// part instead of the raw MAILER-DAEMON text. The body only comes back as fallback if the
// banner reports there was nothing to render (part unreadable or without recipients).
const dsnCardRendered = ref<Record<string, boolean>>({})

const showsDsnCard = (mail: Mail) => !readonly && !isCollapsed(mail) && !!mail.dsn_blob_id

const dsnReplacesBody = (mail: Mail) =>
	showsDsnCard(mail) && dsnCardRendered.value[mail.name] !== false

// The message's calendar invite, if it carries one — as a text/calendar (or application/ics)
// part or a file merely named *.ics.
const icsAttachment = (mail: Mail) =>
	mail.attachments?.find(
		(a: Attachment) =>
			a.blob_id &&
			(a.type?.toLowerCase().startsWith('text/calendar') ||
				a.type?.toLowerCase() === 'application/ics' ||
				a.filename?.toLowerCase().endsWith('.ics')),
	)

const showAttachmentViewer = ref(false)
const attachments = ref<Attachment[]>([])
const attachmentIndex = ref(0)

const openAttachment = (mailAttachments: Attachment[], idx: number) => {
	attachments.value = mailAttachments
	attachmentIndex.value = idx
	showAttachmentViewer.value = true
}

const zippableAttachments = (mail: Mail) =>
	filteredAttachments(mail).filter((a: Attachment) => a.blob_id)

const downloadingZipMail = ref<string | null>(null)

const downloadAttachmentsAsZip = async (mail: Mail) => {
	const mailAttachments = zippableAttachments(mail)
	if (mailAttachments.length < 2) return

	downloadingZipMail.value = mail.name
	try {
		const url = await getAttachmentsZipUrl(mailAttachments, scopeAccountId.value)
		downloadUrlAsFile(url, `${mail.subject || 'attachments'}.zip`)
	} catch {
		// the resource's onError already raised a toast; just stop spinning
	} finally {
		downloadingZipMail.value = null
	}
}

// The message at the end of the conversation stays open — it is the one being read. Drafts do not
// count towards which that is: a reply written at the bottom of the thread is not a newer message,
// it is a thing being written about the last one, and the reader wants both on screen. Read as the
// last row outright, the message being replied to folded itself away the moment the draft under it
// was saved and the thread reloaded around it — every mail already seen comes back collapsed, and
// the exemption had moved on to the draft.
const lastMessage = computed(
	() => [...thread.value].reverse().find((mail: Mail) => !mail.draft) ?? thread.value.at(-1),
)

const isCollapsed = (mail: Mail) => !!(mail.collapsed && mail !== lastMessage.value)

const showReplyAll = (mail: Mail) =>
	!mail.draft &&
	mail.groupedRecipients.to
		?.concat(mail.groupedRecipients.cc)
		.filter((m) => !isUserEmail(m.email)).length > 0

const populateDraftMails = (mail: Mail) =>
	(draftMails[mail.name] = {
		name: mail.name,
		id: mail.id,
		from_email: mail.from_email,
		to: mail.groupedRecipients.to,
		cc: mail.groupedRecipients.cc,
		bcc: mail.groupedRecipients.bcc,
		subject: mail.subject || '',
		in_reply_to: mail.message_id,
		in_reply_to_id: mail.id,
		attachments: mail.attachments || [],
		...extractQuotedContent(mail.html_body),
	})

const reply = (mail: Mail) =>
	createLocalDraft(mail, {
		...getReplyDetails(mail),
		...getReplyRecipients(mail),
		type: 'reply',
	})

const replyAll = (mail: Mail) =>
	createLocalDraft(mail, {
		...getReplyDetails(mail),
		...getReplyAllRecipients(mail),
		type: 'replyAll',
	})

const forward = (mail: Mail) =>
	createLocalDraft(mail, {
		subject: `Fwd: ${mail.subject || ''}`,
		html_body: getForwardedContent(mail),
		attachments: mail.attachments || [],
		forwarded_from_id: mail.id,
		type: 'forward',
	})

const createLocalDraft = (mail: Mail, draftDetails: ComposeMailData) => {
	mail.collapsed = false
	const name = `draft:${mail.name}`
	if (name in draftMails) discardLocalDraft(name)

	nextTick(() => {
		draftMails[name] = { name, ...draftDetails }
		// The thread entry only hosts the inline desktop editor. On mobile the draft
		// lives in the slide-up sheet instead — splicing it in anyway would hide the
		// reply bar (it's suppressed while the thread ends in a draft) until a reload
		// cleans the entry up, well after the sheet has slid out.
		if (isMobile.value) return popOutDraft(draftMails[name])
		const index = thread.value.indexOf(mail)
		const draft = thread.value.find((m: Mail) => m.name === name)
		if (index !== -1 && !draft)
			thread.value.splice(index + 1, 0, { ...draftMails[name], draft: 1, show: true })
		setTimeout(() =>
			threadContainerRef.value
				?.querySelector(`[data-mail-name="${name}"]`)
				?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
		)
	})
}

const discardLocalDraft = (mail: string) => {
	delete draftMails[mail]
	thread.value = thread.value.filter((m: Mail) => m.name !== mail)
}

// Shortcuts

const handleKeydown = (e: KeyboardEvent) => {
	// Read-only views (the Screener) expose no reply/forward, so their shortcuts are inert too.
	if (readonly || shouldIgnoreKeypress(e)) return

	const key = e.key.toLowerCase()
	const lastMail = thread.value?.at(-1)
	if (!lastMail || lastMail.draft) return

	// Reply/Reply All shortcut
	if (key === 'r') {
		e.preventDefault()
		if (e.shiftKey) replyAll(lastMail)
		else reply(lastMail)
		return
	}

	// Forward shortcut
	if (key === 'f') {
		e.preventDefault()
		forward(lastMail)
	}
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

const syncFlagged = (ids: string[], flagged: boolean) =>
	thread.value?.forEach((mail: Mail) => {
		if (ids.includes(mail.id)) mail.flagged = flagged ? 1 : 0
	})

const syncMailboxMembership = (mailboxId: string, add: boolean) => {
	if (add) {
		const mb = scope.mailboxes.value.data?.find((m: MailboxData) => m.id === mailboxId)
		if (!mb) return
		const entry: Mailbox = { mailbox: mb.name, mailbox_id: mb.id, mailbox_name: mb._name }
		thread.value?.forEach((mail: Mail) => {
			if (!mail.mailboxes.some((m) => m.mailbox_id === mailboxId)) mail.mailboxes.push(entry)
		})
	} else if (thread.value?.every((mail: Mail) => mail.mailboxes.length > 1))
		thread.value?.forEach(
			(mail: Mail) =>
				(mail.mailboxes = mail.mailboxes.filter((m) => m.mailbox_id !== mailboxId)),
		)
}

// Optimistically drop a message from the pane (per-message trash/junk/delete) before its request
// fires. Returns whether that emptied the visible thread (so the caller can close the pane + drop the
// row from the list) and a rollback that restores the message in place. Action-agnostic.
const removeMailFromView = (mailId: string): { emptied: boolean; rollback: () => void } => {
	const idx = thread.value.findIndex((m: Mail) => m.id === mailId)
	if (idx === -1) return { emptied: false, rollback: () => {} }
	const [removed] = thread.value.splice(idx, 1)
	removedMailIds.add(mailId)
	return {
		emptied: thread.value.length === 0,
		rollback: () => {
			removedMailIds.delete(mailId)
			// Only re-insert into the pane if it's STILL showing this mail's thread. If the removal
			// emptied the thread, the pane navigated to a different thread by now — splicing the mail in
			// there would append it to an unrelated conversation. The undo restores the thread to the
			// list instead; re-opening it reloads its messages fresh.
			if (removed.thread_id === threadID) thread.value.splice(idx, 0, removed)
		},
	}
}

defineExpose({ syncFlagged, syncMailboxMembership, removeMailFromView })

const focusedDraft = ref<string>()
const showSendModal = ref(false)
const composeWindow = useTemplateRef('composeWindow')

// The id of the draft that went to the window, kept here rather than asked of the window itself.
//
// It has to be a ref, and the reason is the whole of this: a draft popped out is written to on the
// way — the reply learns its own id on the first save — and the thread has to notice. The window
// knows, but it knows in a plain variable inside `useComposeWindow`, which no render is watching;
// a card checking it as it drew got the answer from before the window opened and never asked
// again, so the editor stayed in the thread underneath the very window that had taken it.
const poppedOutDraftId = ref<string>()
watch(
	() => composeWindow.value?.mail?.id,
	(id) => id && (poppedOutDraftId.value = id),
)

// The one draft the composer window is holding, whichever row it has become.
//
// Either name answers, because the row is one thing and then the other. A reply started in the pane
// is a local `draft:<source>` entry with no id at all — a save from in here does not reload the
// thread, so the row keeps that name and never learns one. Popped out, the same save does reload:
// the local row goes, and the server's draft takes its place under a name and an id of its own.
// Matching on the id alone missed the first, and on the name alone missed the second — either way
// the editor sat in the thread underneath the window that had taken it.
//
// Asked of a row rather than assumed of every draft, because "a draft is in the window" is not the
// same question. This pane is reused as the reader moves between threads, so a draft popped out of
// one conversation is still in the window while another is on screen — and that one's own draft is
// not the one being written elsewhere.
const isDraftInWindow = (mail: Mail) => {
	if (!mail.draft) return false
	if (mail.name === focusedDraft.value) return true
	return !!poppedOutDraftId.value && mail.id === poppedOutDraftId.value
}

// A draft being written in the composer window rather than in the thread. The thread stands the
// notice in its place, or the same reply sits in two editors that do not share their state.
//
// Keyed on the window still being open rather than on clearing `focusedDraft`: the card returns the
// moment it closes, and discarding — which reads `focusedDraft` as it fires — still knows which
// draft it meant.
const isPoppedOut = (mail: Mail) =>
	showSendModal.value && !!focusedDraft.value && isDraftInWindow(mail)

// Bring the reply back into the conversation, carrying whatever it has become.
//
// Closing the window is not by itself enough. The window's composer built a draft of its own out of
// the details it was handed, so nothing typed into it has ever reached `draftMails` — the card came
// back reading as it did at the moment of pop-out, and its own autosave then wrote that stale text
// over the server's copy. So the live draft is taken from the composer while it is still there.
// Reading it back from the server instead would mean waiting on the two-second autosave, and a
// reader who clicks this a second after typing is exactly the case that goes wrong.
//
// Copied rather than adopted, and layered over the entry already there: the composer models the
// message and not the thread's bookkeeping, so the reply type — which is what draws the card's
// icon and decides whether From and Subject are shown — survives from underneath.
const showDraftInThread = () => {
	const live = composeWindow.value?.mail
	const name = focusedDraft.value
	if (live && name) draftMails[name] = { ...draftMails[name], ...JSON.parse(JSON.stringify(live)) }
	showSendModal.value = false
}

// Discard, heard as it starts rather than once the delete lands. The card is withheld only while
// the window is open, and `discardMail` closes before it deletes — so without this the thread took
// the draft back and showed it for the length of the request, on its way to being destroyed.
//
// Only the row being discarded: a thread can hold a second draft — a server one and a reply just
// started in the pane — and that one is not going anywhere. The row is going anyway; a delete that
// fails is put back by the reload behind it.
const dropPoppedOutDraft = () => {
	if (!focusedDraft.value) return
	delete draftMails[focusedDraft.value]
	thread.value = thread.value.filter((m: Mail) => !isDraftInWindow(m))
}

const popOutDraft = (mail: ComposeMailData) => {
	draftMails[mail.name as string] = mail

	// Mobile composes on a page of its own rather than in an overlay — see ComposeView. Nothing has
	// to be handed back on the way out: leaving the compose route remounts this thread, so the reply
	// that was just sent is there in the refetch, and a local draft that was discarded is gone with
	// the component that was holding it.
	if (isMobile.value) {
		openComposePage(router, scopeAccountId.value, mail)
		return
	}

	// Taken here as well as from the window, so the card goes the moment the window opens rather than
	// a frame later, once the composer inside it has mounted and can be asked.
	poppedOutDraftId.value = mail.id
	focusedDraft.value = mail.name
	showSendModal.value = true
}

const getSourceMail = (mail: string) =>
	thread.value.find((m: Mail) => m.name === mail.split(':')[1])

const getReplyDetails = (mail: Mail) => ({
	subject: mail.subject?.startsWith('Re: ') ? mail.subject : `Re: ${mail.subject}`,
	quoted_content: getQuotedContent(mail),
	attachments: mail.attachments?.filter((a: Attachment) => a.disposition === 'inline') || [],
	in_reply_to: mail.message_id,
	in_reply_to_id: mail.id,
})

const getReplyRecipients = (mail: Mail) => ({
	to: isUserEmail(mail.from_email)
		? mail.groupedRecipients.to
		: mail.reply_to.length
			? mail.reply_to
			: [{ email: mail.from_email }],
})

const getReplyAllRecipients = (mail: Mail) => {
	if (isUserEmail(mail.from_email))
		return { to: mail.groupedRecipients.to, cc: mail.groupedRecipients.cc }
	else
		return {
			to: mail.reply_to.length ? mail.reply_to : [{ email: mail.from_email }],
			cc: [...mail.groupedRecipients.to, ...mail.groupedRecipients.cc].filter(
				(r) => !isUserEmail(r.email),
			),
		}
}

const isUserEmail = (email: string) =>
	identities.value.data?.map((i: Identity) => i.email).includes(email)

// The plain-text reading of a body, normalised. Servers hand some bodies over already
// entity-escaped, and those carry no real tags — so they take this path, where showing
// them verbatim (or escaping them again) puts `&lt;` in front of the reader instead of
// the address it stands for. Both consumers below start from here.
const getPlainTextBody = (mail: Mail) => decodeHtmlEntities(mail.html_body || mail.text_body || '')

// A body with no markup is plain text, so it has to be escaped before going into the
// <pre> — the reader parses this as HTML. Bounce notices are the case that bites:
// their `RCPT TO:<user@host>` reads as an unknown tag, which the sanitizer then drops,
// silently deleting the very addresses the notice is about.
const getBodyContent = (mail: Mail) => {
	if (hasHtmlContent(mail.html_body)) return mail.html_body
	const text = getPlainTextBody(mail)
	return `<pre style="white-space: pre-wrap; word-break: break-word">${text ? escapeHtml(text) : '&nbsp;'}</pre>`
}

const getQuotedContent = (mail: Mail) =>
	`
		<div class="frappe_mail_quote">
			On ${dayjs(mail.received_at).format('DD MMM YYYY [at] h:mm A')}, ${mail.from_email} wrote:
			<blockquote style="margin-left: 8px">
				${getBodyContent(mail)}
			</blockquote>
		</div>
	`

const getForwardedContent = (mail: Mail) => {
	const recipients = getGroupedRecipients(mail.recipients, true, true)
	return `
		<div class="frappe_mail_fwd">
			<br><br>
			---------- Forwarded message ---------<br>
			From: ${mail.from_name} < ${mail.from_email} ><br>
			Date: ${dayjs(mail.received_at).format('ddd, MMM D, YYYY [at] h:mm A')}<br>
			Subject: ${mail.subject || ''}<br>
			To: ${recipients.to}<br>
			${recipients.cc ? `Cc: ${recipients.cc}<br>` : ''}
			<br><br>
			${getBodyContent(mail)}
		</div>
	`
}
</script>

