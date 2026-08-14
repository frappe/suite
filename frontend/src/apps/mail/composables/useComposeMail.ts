import { computed, inject, onScopeDispose, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { watchDebounced } from '@vueuse/core'
import { createResource } from 'frappe-ui'
import { Mention } from 'frappe-ui/editor'

import { getAttachmentUrl } from '@/apps/mail/resources'
import { processInlineImages, raiseToast } from '@/apps/mail/utils'
import { createMentionSuggestion } from '@/apps/mail/utils/mentionSuggestion'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'

import type { ComposeMailData, Identity, UserResource } from '@/apps/mail/types'
import type { MentionCandidate } from '@/apps/mail/utils/mentionSuggestion'

/** The mounted TextEditor instance, as far as this composable cares about it. */
interface EditorHost {
	$el?: HTMLElement
	editor?: {
		commands: { insertContent: (content: string) => void; focus: () => void }
		state: { doc: { descendants: (fn: (node: any) => void) => void } }
	}
}

export interface ComposeMailOptions {
	/** A draft being resumed, or the reply/forward this composition starts from. */
	mailDetails?: ComposeMailData
	/** Inline in a thread (desktop), rather than a composer of its own. */
	isInThread?: boolean
	reloadMails: () => void
	/** Take the composer off screen — the dialog's v-model on desktop, a route pop on mobile. */
	close: () => void
	/** Whether the composer is still on screen. Drives whether a result is worth a toast. */
	isOpen: () => boolean
	/** Called instead of a server delete when discarding something never saved. */
	onDiscardUnsaved?: () => void
	/**
	 * Fired the moment Discard is pressed, before the composer comes off screen — unlike
	 * `onDiscardUnsaved`, which reports the outcome once the network is done. A host that shows the
	 * draft somewhere else needs the earlier signal: `discardMail` closes first and deletes after,
	 * so anything keyed on the composer being open takes the draft back for the moment in between.
	 */
	onDiscardStarted?: () => void
	/** The mounted TextEditor, for mention bookkeeping and emoji insertion. */
	host: () => EditorHost | null | undefined
	/**
	 * Where the mention dropdown should render. The dialog on desktop, which holds the rest of the
	 * page inert; null anywhere `<body>` will do.
	 */
	mentionContainer?: () => HTMLElement | null
}

/**
 * Everything a composition *is*, with no opinion on how it's laid out: the draft itself, saving,
 * sending, scheduling, discarding, attachments and mentions.
 *
 * Split out because compose has two very different shapes — a dialog on desktop, a full page on
 * mobile — and the only way to keep those from drifting into two subtly different mail clients is
 * for the behaviour to live in one place and only the markup to differ.
 */
export const useComposeMail = (options: ComposeMailOptions) => {
	const { mailDetails, isInThread = false, reloadMails, close, isOpen, host } = options

	// A composer that has gone away must not still be writing drafts. Saving is debounced by two
	// seconds, and the timer outlives the component: pop a draft out inside that window and the
	// editor left behind in the thread would wake up and create a second draft of its own, next to
	// the one the composer window creates. The window's copy is the only one that should land.
	let disposed = false
	onScopeDispose(() => (disposed = true))

	const router = useRouter()
	const route = useRoute()

	// Sends as the enclosing pane's account (the thread's owning account in All Inboxes, the active
	// one everywhere else): identities, the default outgoing address and every draft call resolve
	// through this scope.
	const user = inject('$user') as UserResource
	const scope = injectAccountScope()
	const { accountId: scopeAccountId, identities, mailboxIds } = scope

	const getIdentity = (email: string) =>
		identities.value.data?.find((identity: Identity) => identity.email === email)

	const viewSentMessage = (threadID: string) =>
		router.push({
			name: 'mail-mail',
			params: { accountId: scopeAccountId.value, mailbox: mailboxIds.value.sent, threadID },
		})

	const getDefaultFromEmail = () => {
		const identityEmails = identities.value.data?.map((i: Identity) => i.email) ?? []
		const defaultOutgoingEmail = scope.account.value?.default_outgoing_email

		return (
			identityEmails.find((e) => e === mailDetails?.from_email) ??
			identityEmails.find((e) => e === defaultOutgoingEmail) ??
			identityEmails[0] ??
			// An account with no identities at all still has to send as somebody.
			user.data.name
		)
	}

	const mail = reactive<ComposeMailData>({
		name: mailDetails?.name || '',
		id: mailDetails?.id || '',
		from_email: getDefaultFromEmail(),
		to: mailDetails?.to || [],
		cc: mailDetails?.cc || [],
		bcc: mailDetails?.bcc || [],
		attachments: mailDetails?.attachments || [],
		subject: mailDetails?.subject || '',
		html_body: mailDetails?.html_body || '',
		quoted_content: mailDetails?.quoted_content || '',
		in_reply_to: mailDetails?.in_reply_to || '',
		in_reply_to_id: mailDetails?.in_reply_to_id || '',
		forwarded_from_id: mailDetails?.forwarded_from_id || '',
	})

	const originalMail = ref<ComposeMailData>()
	const updateOriginalMail = () => (originalMail.value = JSON.parse(JSON.stringify(mail)))
	const isDraftUpdated = computed(() => JSON.stringify(mail) !== JSON.stringify(originalMail.value))

	// ── What's in the mail ──────────────────────────────────────────────────────────────────────

	const isRecipientsEmpty = computed(() => [mail.to, mail.cc, mail.bcc].every((d) => !d.length))

	const isBodyEmpty = computed(() => {
		if (!mail.html_body) return true

		const element = document.createElement('div')
		element.innerHTML = mail.html_body

		return !element.textContent?.trim() && element.querySelector('img, video, svg') === null
	})

	const isMailEmpty = computed(
		() =>
			!mail.subject &&
			!mail.quoted_content &&
			!mail.attachments?.length &&
			isRecipientsEmpty.value &&
			isBodyEmpty.value,
	)

	const openQuotedContent = () => {
		mail.html_body += `<br>${mail.quoted_content}`
		mail.quoted_content = ''
	}

	// ── Signature ───────────────────────────────────────────────────────────────────────────────

	const buildSignature = (email?: string) => {
		const identity = getIdentity(email!)
		return identity?.text_signature
			? `<div><br></div><div><br></div>${identity.html_signature}`
			: ''
	}

	const bodyText = (html: string) => {
		const element = document.createElement('div')
		element.innerHTML = html || ''
		return element.textContent?.trim() ?? ''
	}

	// Swap the signature when the From identity changes — but only while the body is still the
	// auto-inserted signature (or empty), so a message the user has written isn't overwritten.
	// Compared by text so the editor's HTML normalization doesn't defeat the match.
	watch(
		() => mail.from_email,
		(val, oldVal) => {
			if (isBodyEmpty.value || bodyText(mail.html_body) === bodyText(buildSignature(oldVal)))
				mail.html_body = buildSignature(val)
		},
		{ immediate: true },
	)

	// ── Sending, saving, discarding ─────────────────────────────────────────────────────────────

	const isSavingDraft = ref(false)
	const isDiscarding = ref(false)

	const saveDraft = async () => {
		if (disposed) return
		if (!isDraftUpdated.value || isLoading.value || isDiscarding.value) return

		isSavingDraft.value = true
		if (mail.id) await updateDraft.submit({ submit: false })
		else if (!isMailEmpty.value) await createMail.submit({ save_as_draft: true })
		isSavingDraft.value = false
	}

	watchDebounced(mail, () => saveDraft(), { debounce: 2000 })

	// Mirrors UNDO_SEND_WINDOW_SECONDS in api/mail.py; the server holds delivery a few seconds
	// longer than this so a last-moment Undo still lands in time.
	const UNDO_SEND_WINDOW_MS = 10000

	// A plain Send holds delivery for the undo window ('undo'); Schedule send passes an explicit time
	// ('scheduled'). Both come back as 'Scheduled', so the toast has to know which one it confirms.
	const sendMode = ref<'undo' | 'scheduled'>('undo')

	const sendMail = async (sendAt?: string) => {
		if (deleteMail.loading) return

		if (isRecipientsEmpty.value)
			return raiseToast(__('Please add at least one recipient.'), 'error')

		sendMode.value = sendAt ? 'scheduled' : 'undo'
		isSavingDraft.value = false
		close()
		if (createMail.loading) await createMail.promise
		if (updateDraft.loading) await updateDraft.promise

		if (mail.id) updateDraft.submit({ submit: true, send_at: sendAt, undo_send: !sendAt })
		else createMail.submit({ save_as_draft: false, send_at: sendAt, undo_send: !sendAt })
	}

	const discardMail = async () => {
		if (deleteMail.loading) return

		isDiscarding.value = true
		// Before close(), and synchronously: the host has to learn the draft is going while it is
		// still on screen. Told afterwards, it sees the composer close first and puts the draft
		// back for as long as the delete takes.
		options.onDiscardStarted?.()
		close()
		if (createMail.loading) await createMail.promise
		if (updateDraft.loading) await updateDraft.promise
		if (mail.id) deleteMail.submit()
		else options.onDiscardUnsaved?.()
	}

	/** Reset the in-flight flags once the composer is off screen. */
	const onClosed = () => {
		isDiscarding.value = false
		isSavingDraft.value = false
	}

	// Schedule send (FUTURERELEASE)

	const showScheduleModal = ref(false)

	const openScheduleModal = () => {
		if (isRecipientsEmpty.value)
			return raiseToast(__('Please add at least one recipient.'), 'error')

		showScheduleModal.value = true
	}

	const scheduleSend = (sendAt: string) => sendMail(sendAt)

	// Undo send: Send actually scheduled delivery a few seconds out (a server-side hold), so undoing
	// is just cancelling that schedule — the message lands back in Drafts.
	const undoSend = createResource({
		url: 'suite.mail.api.mail.cancel_scheduled_mail',
		makeParams: ({ name }: { name: string }) => ({ account: scopeAccountId.value, name }),
		onSuccess: () => {
			reloadMails()
			raiseToast(__('Sending undone. The message is back in your drafts.'))
		},
		onError: (error: { message: string }) => raiseToast(error.message, 'error'),
	})

	const onMailUpdateSuccess = ({
		name,
		id,
		status,
		error,
		thread_id,
	}: {
		name: string
		id: string
		status: string
		error: string
		thread_id?: string
	}) => {
		if (id) mail.id = id
		updateOriginalMail()
		if (error) return raiseToast(error, 'error')
		if (isDiscarding.value) return

		if (!isInThread || status === 'Submitted' || status === 'Scheduled') reloadMails()
		if (isOpen()) return

		if (status === 'Drafted' && isSavingDraft.value) raiseToast(__('Draft saved.'))
		else if (status === 'Submitted')
			raiseToast(
				__('Message sent.'),
				'success',
				// No View action when the sent mail's thread is already open in front of the user.
				thread_id && route.params.threadID !== thread_id
					? { label: __('View'), onClick: () => viewSentMessage(thread_id) }
					: undefined,
			)
		else if (status === 'Scheduled' && sendMode.value === 'undo')
			// Two buttons, and they are not equals: Undo expires with the toast, so it takes the
			// urgent slot; View is an aside you could reach any time from Sent, offered only when the
			// thread isn't already the one in front of you.
			raiseToast(
				__('Message sent.'),
				'success',
				{ label: __('Undo'), onClick: () => undoSend.submit({ name }) },
				UNDO_SEND_WINDOW_MS,
				thread_id && route.params.threadID !== thread_id
					? { label: __('View'), onClick: () => viewSentMessage(thread_id) }
					: undefined,
			)
		else if (status === 'Scheduled')
			raiseToast(__('Send scheduled.'), 'success', {
				label: __('View'),
				onClick: () =>
					router.push({
						name: 'mail-scheduled',
						params: { accountId: scopeAccountId.value },
					}),
			})
	}

	// ── Resources ───────────────────────────────────────────────────────────────────────────────

	const createMail = createResource({
		url: 'suite.mail.api.mail.create_mail',
		makeParams: ({
			save_as_draft,
			send_at,
			undo_send,
		}: {
			save_as_draft: boolean
			send_at?: string
			undo_send?: boolean
		}) => ({
			account: scopeAccountId.value,
			...mail,
			...processInlineImages(mail, { sending: !save_as_draft }),
			from_name: getIdentity(mail.from_email!)._name,
			save_as_draft,
			send_at,
			undo_send,
		}),
		onSuccess: onMailUpdateSuccess,
		onError: (error: { message: string }) => raiseToast(error.message, 'error'),
	})

	const updateDraft = createResource({
		url: 'suite.mail.api.mail.update_draft_mail',
		makeParams: ({
			submit,
			send_at,
			undo_send,
		}: {
			submit: boolean
			send_at?: string
			undo_send?: boolean
		}) => ({
			account: scopeAccountId.value,
			...mail,
			...processInlineImages(mail, { sending: submit }),
			from_name: getIdentity(mail.from_email!)._name,
			submit,
			send_at,
			undo_send,
		}),
		onSuccess: onMailUpdateSuccess,
		onError: (error: { message: string }) => raiseToast(error.message, 'error'),
	})

	const deleteMail = createResource({
		url: 'suite.mail.api.mail.delete_mail',
		makeParams: () => ({ account: scopeAccountId.value, id: mail.id }),
		onSuccess: () => {
			reloadMails()
			raiseToast(__('Draft discarded.'))
		},
		onError: (error: { message: string }) => raiseToast(error.message, 'error'),
	})

	const isLoading = computed(() => createMail.loading || updateDraft.loading || deleteMail.loading)

	// ── Attachments ─────────────────────────────────────────────────────────────────────────────

	const openAttachment = async (blob_id?: string, type?: string) => {
		if (!blob_id) return

		// Opened up front, while the click's user activation is still live: Safari blocks
		// window.open() once the gesture has expired, which it has by the time the attachment has
		// been fetched. A null tab means the popup blocker got it — retrying after the fetch would
		// hit the same block, so just say so.
		const tab = window.open('', '_blank')
		if (!tab) return raiseToast(__('Allow popups to open attachments.'), 'error')

		try {
			tab.location.href = await getAttachmentUrl(blob_id, type, scopeAccountId.value)
		} catch {
			tab.close()
		}
	}

	// ── Mentions ────────────────────────────────────────────────────────────────────────────────

	// Picking a mention adds that person to To — reaching back up to the recipient fields is the trip
	// the shortcut exists to save. Only the pick adds, so a mention arriving with pasted or forwarded
	// content doesn't quietly address the mail to anyone.
	//
	// Recipients this composer added that way, and only those: deleting the mention takes them back
	// out again, while someone typed into To by hand and then mentioned stays put — the mention
	// didn't put them there and doesn't get to remove them.
	const mentionedRecipients = new Set<string>()

	const addMentionedRecipient = ({ email, display_name, image }: MentionCandidate) => {
		if ([...mail.to, ...mail.cc, ...mail.bcc].some((r) => r.email === email)) return

		mail.to.push({ email, display_name, image })
		mentionedRecipients.add(email)
	}

	const dropUnmentionedRecipients = () => {
		const editor = host()?.editor
		if (!editor || !mentionedRecipients.size) return

		const mentioned = new Set<string>()
		editor.state.doc.descendants((node) => {
			if (node.type.name === 'mention' && node.attrs.id) mentioned.add(node.attrs.id)
		})

		for (const email of mentionedRecipients) {
			// Still named somewhere in the body — mentioning someone twice and deleting one of the
			// two keeps them addressed.
			if (mentioned.has(email)) continue

			mail.to = mail.to.filter((recipient) => recipient.email !== email)
			mentionedRecipients.delete(email)
		}
	}

	const mentionExtensions = [
		// The inline node. Its own `@` suggester stays inert with no item source of its own — the
		// search below is the one wired up.
		Mention,
		createMentionSuggestion({
			account: () => scopeAccountId.value,
			onSelect: addMentionedRecipient,
			container: () => options.mentionContainer?.() ?? null,
		}),
	]

	const appendEmoji = (emoji: string) => {
		const editor = host()?.editor
		editor?.commands.insertContent(emoji)
		editor?.commands.focus()
	}

	/** The body as the editor should receive it, and the inverse on the way back out. */
	const editorContent = computed(() => mail.html_body.replaceAll('<div><br></div>', '<div></div>'))
	const onEditorChange = (value: string) => {
		mail.html_body = value.replaceAll('<div></div>', '<div><br></div>')
		dropUnmentionedRecipients()
	}

	return {
		mail,
		scope,
		scopeAccountId,
		identities,
		getIdentity,
		updateOriginalMail,
		isDraftUpdated,
		isRecipientsEmpty,
		isBodyEmpty,
		isMailEmpty,
		isLoading,
		isSavingDraft,
		isDiscarding,
		saveDraft,
		sendMail,
		discardMail,
		onClosed,
		showScheduleModal,
		openScheduleModal,
		scheduleSend,
		openQuotedContent,
		openAttachment,
		mentionExtensions,
		appendEmoji,
		editorContent,
		onEditorChange,
	}
}
