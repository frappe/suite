import { toast } from 'frappe-ui'
import { Mention } from 'frappe-ui/editor'
import { computed, inject, nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, client, useMutation, type InputOf, type OutputOf } from '@/api'
import {
  classifySaveError,
  createDraftSaver,
  type WriteOptions,
} from '@/apps/mail/composables/draftSaver'
import { withdrawDraftCopyOffer } from '@/apps/mail/composables/useDraftRecovery'
import { getAttachmentUrl } from '@/apps/mail/resources'
import type { ComposeMailData, DraftRecipient, Identity, UserResource } from '@/apps/mail/types'
import { commitAfterUndo, processInlineImages, raiseToast } from '@/apps/mail/utils'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'
import {
  useComposeMail as useComposeRequest,
  useDiscardingDrafts,
  useListReload,
  useUndo,
} from '@/apps/mail/utils/composables'
import {
  findDraftCopy,
  heldDraftCopyKeys,
  holdDraftCopy,
  removeDraftCopy,
  writeDraftCopy,
  type DraftCopy,
} from '@/apps/mail/utils/draftCopies'
import { createEditorBody } from '@/apps/mail/utils/editorBody'
import { createMentionSuggestion, type MentionCandidate } from '@/apps/mail/utils/mentionSuggestion'
import {
  moveRecipient as moveRecipientBetweenFields,
  type RecipientField,
} from '@/apps/mail/utils/recipientFields'
import { undoSendPeriodOf } from '@/apps/mail/utils/undoSend'
import { randomId } from '@/platform/random-id'

/** The mounted TextEditor instance, as far as this composable cares about it. */
interface EditorHost {
  $el?: HTMLElement
  editor?: {
    commands: {
      insertContent: (content: string) => void
      focus: () => void
      setTextSelection: (range: { from: number; to: number }) => void
    }
    state: {
      doc: {
        descendants: (fn: (node: any) => void) => void
      }
      selection: { from: number; to: number }
    }
  }
}
interface ComposeMailOptions {
  /** A draft being resumed, or the reply/forward this composition starts from. */
  mailDetails?: ComposeMailData
  /** Inline in a thread (desktop), rather than a composer of its own. */
  isInThread?: boolean
  reloadMails: () => void
  /** Take the composer off screen — the dialog's v-model on desktop, a route pop on mobile. */
  close: () => void
  /** Whether the composer is still on screen. Drives whether a result is worth a toast. */
  isOpen: () => boolean
  /** Called as a discard takes the draft off screen, so a host showing it elsewhere drops it too. */
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
   * Addresses typed but not yet made into recipients: they are on screen, so a send has to include
   * them. The fields are the host's.
   */
  commitTypedRecipients?: () => void
  /**
   * Where the mention dropdown should render. The dialog on desktop, which holds the rest of the
   * page inert; null anywhere `<body>` will do.
   */
  mentionContainer?: () => HTMLElement | null
}

/**
 * Everything a composition *is*, with no opinion on how it's laid out: the draft itself, saving
 * (see draftSaver), sending, scheduling, discarding, attachments and mentions.
 *
 * Split out because compose has two very different shapes — a dialog on desktop, a full page on
 * mobile — and the only way to keep those from drifting into two subtly different mail clients is
 * for the behaviour to live in one place and only the markup to differ.
 */
const newDraftKey = () => randomId()

export const useComposeMail = (options: ComposeMailOptions) => {
  const { mailDetails, isInThread = false, reloadMails, close, isOpen, host } = options

  const { requestCompose } = useComposeRequest()
  const { requestListReload } = useListReload()
  const { holdDraft, releaseDraft, restoreDraft } = useDiscardingDrafts()
  const router = useRouter()
  const route = useRoute()

  // Sends as the enclosing pane's account (the thread's owning account in All Inboxes, the active
  // one everywhere else): identities, the default outgoing address and every draft call resolve
  // through this scope.
  const user = inject<UserResource>('$user')
  if (!user) throw new Error('Mail user resource is not provided')
  const scope = injectAccountScope()
  const { accountId: scopeAccountId, identities, mailboxIds } = scope
  const getIdentity = (email: string) =>
    identities.value.data?.find((identity: Identity) => identity.email === email)
  const viewSentMessage = (threadID: string) =>
    router.push({
      name: 'mail-mail',
      params: {
        accountId: scopeAccountId.value,
        mailbox: mailboxIds.value.sent,
        threadID,
      },
    })
  const getDefaultFromEmail = () => {
    const identityEmails = identities.value.data?.map((i: Identity) => i.email) ?? []
    const defaultOutgoingEmail = scope.account.value?.default_outgoing_email
    // Matched case-insensitively; the identity's own spelling is what goes out.
    const identityMatching = (email?: string | null) =>
      identityEmails.find((e) => e.toLowerCase() === email?.toLowerCase())
    return (
      identityMatching(mailDetails?.from_email) ??
      identityMatching(defaultOutgoingEmail) ??
      identityEmails[0] ??
      // An account with no identities at all still has to send as somebody.
      user.data.name
    )
  }
  const mail = reactive({
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
    composed: true,
    // Set as the draft is handed to another composer with text not yet saved; see `handOff`.
    restored: false,
    // Which composition this is, across the id each save gives it (see `draft_key` on the server).
    draft_key: mailDetails?.draft_key || newDraftKey(),
  })
  // Everything that makes up what the writer sees, and nothing the server gives back.
  const writing = () =>
    JSON.stringify([
      mail.from_email,
      mail.to,
      mail.cc,
      mail.bcc,
      mail.subject,
      mail.html_body,
      mail.quoted_content,
      mail.attachments,
    ])

  // ── What's in the mail ──────────────────────────────────────────────────────────────────────

  const isRecipientsEmpty = computed(() => [mail.to, mail.cc, mail.bcc].every((d) => !d.length))

  // Files on their way up. Not yet part of the draft, so they count as unsaved: they keep leaving
  // from warning and sending from going, and a composer that closes waits for them to finish.
  const uploads = ref<string[]>([])
  const inUpload = new Set<Promise<unknown>>()
  const isUploading = computed(() => uploads.value.length > 0)
  const trackUpload = <T>(name: string, upload: Promise<T>): Promise<T> => {
    uploads.value = [...uploads.value, name]
    const done = upload.finally(() => {
      const index = uploads.value.indexOf(name)
      uploads.value = uploads.value.filter((_, at) => at !== index)
      inUpload.delete(done)
    })
    inUpload.add(done)
    return done
  }

  /**
   * Re-addressing someone: To → Cc, Cc → Bcc, either way round. Held here because the draft owns
   * all three lists and a recipient field owns only its own — a field asked to give someone up has
   * nowhere to put them.
   */
  const moveRecipient = (recipient: DraftRecipient, from: RecipientField, to: RecipientField) =>
    moveRecipientBetweenFields(mail, recipient.email, from, to)
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
  // A fresh composition the reader has not written in: its fields still what it opened with (a
  // reply's recipients and quote, a forward's attachments) and its body only the signature and any
  // prefill. A draft reopened from Drafts is never this — what it holds was written before.
  const fieldsOf = () =>
    JSON.stringify([
      mail.to,
      mail.cc,
      mail.bcc,
      mail.subject,
      mail.attachments,
      mail.quoted_content,
    ])
  const openedWith = fieldsOf()
  const isUntouched = computed(
    () =>
      !isSavedDraft &&
      !uploads.value.length &&
      fieldsOf() === openedWith &&
      bodyText(mail.html_body) === bodyText(buildSignature(mail.from_email) + prefilledBody) &&
      // Text alone missed a pasted or inserted image: a body that was only that read as untouched,
      // and leaving it closed the draft without an Undo.
      imageCount(mail.html_body) === imageCount(buildSignature(mail.from_email) + prefilledBody),
  )
  // The editor takes the unfolded body as new content, and leaves the quote selected: the next
  // keystroke would type it away. The caret goes back to where the writer left it.
  const openQuotedContent = () => {
    const editor = host()?.editor
    const caret = editor?.state.selection
    mail.html_body += `<br>${mail.quoted_content}`
    mail.quoted_content = ''
    if (editor && caret)
      nextTick(() => editor.commands.setTextSelection({ from: caret.from, to: caret.to }))
  }

  // ── Signature ───────────────────────────────────────────────────────────────────────────────

  // The wrapper is what lets the text/plain alternative introduce the block with RFC 3676's
  // "-- " separator; by the time a body reaches the server the signature is ordinary markup.
  // Gated on the HTML form, which is the one actually inserted.
  const buildSignature = (email?: string) => {
    const identity = getIdentity(email!)
    return identity?.html_signature
      ? '<div><br></div><div><br></div><div class="frappe_mail_signature">' +
          identity.html_signature +
          '</div>'
      : ''
  }
  const imageCount = (html: string) => (html?.match(/<img\b/gi) ?? []).length
  const bodyText = (html: string) => {
    const element = document.createElement('div')
    element.innerHTML = html || ''
    return element.textContent?.trim() ?? ''
  }

  // A draft that already exists on the server arrives with the body it was left with, and an empty
  // one is a decision: the signature was deleted and the draft saved that way. So nothing is put
  // back into it — not on the way in (this watcher is immediate, and a composer starts afresh every
  // time a draft is opened), and not when the identity changes later.
  //
  // A composition that has never been saved is the other case entirely: its empty body is merely
  // empty, and is where a signature belongs. Unless it was written in another composer first — a
  // reply popped out of its thread before its first save. Its body is the one written there,
  // signature included; read as a fresh one's prefill, it got a second signature above the first.
  const isSavedDraft = !!mailDetails?.id || !!mailDetails?.composed

  // A fresh composition can open with prefilled content — a forward's header block. It rides
  // along untouched: the signature is inserted above it, and the pristine-body comparison
  // below includes it.
  const prefilledBody = isSavedDraft ? '' : mailDetails?.html_body || ''

  // Swap the signature when it changes — a different From identity, or the identities arriving
  // after the composer opened (a fresh compose can open before they have loaded, and then starts
  // from the account's address with no signature to put in) — but only while the body is still the
  // auto-inserted signature (or empty/prefilled), so a message the user has written isn't
  // overwritten. Compared by text so the editor's HTML normalization doesn't defeat the match.
  watch(
    () => buildSignature(mail.from_email),
    (signature, previous) => {
      if (isBodyEmpty.value && isSavedDraft) return
      if (
        isBodyEmpty.value ||
        bodyText(mail.html_body) === bodyText((previous ?? '') + prefilledBody)
      )
        mail.html_body = signature + prefilledBody
    },
    {
      immediate: true,
    },
  )

  // ── Sending, saving, discarding ─────────────────────────────────────────────────────────────

  const isDiscarding = ref(false)
  const isSending = ref(false)

  // Set by a draft save made inside a thread, cleared by paying it. See onMailUpdateSuccess.
  let listOwesReload = false

  /**
   * Bring the list up to date with the draft, once the editor is done with it.
   *
   * Called on the way out, after the last save has landed — earlier and the reload would fetch the
   * draft as it was a keystroke ago and put that back on screen.
   */
  const payListDebt = () => {
    if (!listOwesReload) return
    listOwesReload = false
    reloadMails()
  }
  // A draft is not edited in place: each save replaces it, under a new id. A list that has not
  // reloaded since still shows it by an earlier one, so a discard has to hold all of them.
  const formerIds = new Set<string>()

  // The account a draft on the server belongs to, whichever the scope has moved on to. The composer
  // window outlives the account it was opened in, and a draft's id means nothing in another one.
  let savedIn = mailDetails?.id ? scopeAccountId.value : ''
  const draftAccount = () => savedIn || scopeAccountId.value

  // ── The local copy, for while the server can't take the draft ───────────────────────────────

  const copyUser = () => user.data?.name
  // What can't be saved is kept here only if this says so. Blocked or full storage leaves nothing
  // behind, which is what leaving warns about.
  const isCopyKept = ref(false)
  let releaseCopy: (() => void) | undefined
  const keepCopy = () => {
    const owner = copyUser()
    if (!owner) return
    const copy: DraftCopy = {
      key: mail.draft_key,
      user: owner,
      account: draftAccount(),
      ids: [mail.id, ...formerIds].filter(Boolean),
      savedAt: Date.now(),
      uploading: [...uploads.value],
      mail: JSON.parse(
        JSON.stringify({
          from_email: mail.from_email,
          to: mail.to,
          cc: mail.cc,
          bcc: mail.bcc,
          subject: mail.subject,
          html_body: mail.html_body,
          quoted_content: mail.quoted_content,
          attachments: mail.attachments,
          in_reply_to: mail.in_reply_to,
          in_reply_to_id: mail.in_reply_to_id,
          forwarded_from_id: mail.forwarded_from_id,
        }),
      ),
    }
    isCopyKept.value = writeDraftCopy(copy)
    // While this composer runs, the copy is its own and not one for another tab to offer back.
    if (isCopyKept.value) releaseCopy ??= holdDraftCopy(mail.draft_key)
  }
  const dropCopy = () => {
    const owner = copyUser()
    if (owner) removeDraftCopy(owner, draftAccount(), mail.draft_key)
    withdrawDraftCopyOffer(mail.draft_key)
    isCopyKept.value = false
    releaseCopy?.()
    releaseCopy = undefined
  }

  // ── Saving ──────────────────────────────────────────────────────────────────────────────────

  let finished = false
  const saver = createDraftSaver({
    read: writing,
    canSave: () => !!mail.id || !isMailEmpty.value,
    write: (options) =>
      mail.id
        ? updateDraftSubmit({ submit: false }, options)
        : createMailSubmit({ save_as_draft: true }, options),
    keepCopy,
    dropCopy: () => {
      dropCopy()
      settledAfterLeaving()
    },
    onRefused: (message) => raiseToast(__('Draft not saved. {0}', [message]), 'error'),
    onStopped: () => {
      finished = true
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onHidden)
      releaseCopy?.()
      releaseCopy = undefined
    },
  })
  watch(writing, () => saver.edited())

  /**
   * Save now: a decision rather than a leftover timer, and not gated on the composer still being
   * there, because the composer makes one on the way out. Resolves true if the server has it all.
   */
  const saveDraft = () => saver.saveNow()

  // What the save state shows. Uploads come first: until a file is up, "Saved" would be untrue.
  const saveState = computed(() => ({
    status: saver.status.value,
    failure: saver.failure.value,
    isCopyKept: isCopyKept.value,
    isRetrying: saver.isWriting.value,
    isUploading: isUploading.value,
  }))

  // ── Leaving ─────────────────────────────────────────────────────────────────────────────────

  // Nothing is lost if this tab closes now: on the server, or kept on the device.
  const isSafeToClose = computed(
    () =>
      !isUploading.value &&
      (!saver.hasUnsaved.value || (saver.status.value !== 'saving' && isCopyKept.value)),
  )

  // Beyond a page's last moments only a keepalive request gets through, and browsers refuse one with
  // a body over 64KB outright, so a long mail goes as an ordinary request and takes its chances.
  const KEEPALIVE_LIMIT = 60_000
  const leavingOptions = (): WriteOptions =>
    writing().length < KEEPALIVE_LIMIT ? { keepalive: true } : {}

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (isSafeToClose.value) return
    void saver.saveNow(leavingOptions())
    event.preventDefault()
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- older browsers still need it
    event.returnValue = ''
  }
  // A phone gets no warning: the page is just put away, and may never run again. So it saves as it
  // goes, and what fails there is in the local copy by then.
  const onHidden = () => {
    if (document.visibilityState === 'hidden' && saver.isDirty.value)
      void saver.saveNow(leavingOptions())
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('visibilitychange', onHidden)

  // The end of this composition's saving. The copy stays for whoever comes back to it, if it holds
  // anything the server doesn't.
  const finish = () => saver.stop()

  let left = false
  let unsavedToast: ReturnType<typeof toast.error> | undefined
  // Off screen and in sync at last: the composition has nothing more to do. Not while a file is still
  // on its way up: `leave` saves that one once it arrives.
  function settledAfterLeaving() {
    if (!left || uploads.value.length) return
    if (unsavedToast !== undefined) {
      toast.dismiss(unsavedToast)
      unsavedToast = undefined
      raiseToast(__('Draft saved.'))
    }
    finish()
  }

  /**
   * The composer is coming off screen. Files still on their way are waited for: they would otherwise
   * finish with nothing left to save them. After that, whatever is left is saved; failing that, the
   * writer is told, and it goes on trying from here, off screen, until it lands.
   */
  const leave = async () => {
    if (finished) return
    left = true
    await Promise.allSettled(inUpload)
    const saved = await saver.saveNow()
    if (finished) return
    if (saved || !saver.hasUnsaved.value) finish()
    else keepUnsavedDraft()
  }

  /** Reopen a draft this composer left behind: the new composer takes over from it. */
  const takeBack = () => {
    finish()
    if (unsavedToast !== undefined) toast.dismiss(unsavedToast)
    unsavedToast = undefined
  }

  /**
   * Another composer takes over this very draft (popping out of a thread). This one stops where it
   * is, and says whether the other has text to save: what it opens with otherwise counts as saved.
   */
  const handOff = () => {
    mail.restored = saver.isDirty.value
    finish()
    return mail
  }

  /**
   * The composer is on screen. What it opened with counts as saved, so only an edit saves it —
   * except a draft Undo or a recovery brought back, whose text may never have reached the server:
   * that is saved now, or closing it unedited lost the last of it, and a draft never saved at all
   * went with it. Every composer calls this once mounted: the window, a thread's reply and the
   * phone's page.
   */
  const onOpened = () => {
    if (mailDetails?.restored) void saver.saveNow()
    else saver.baseline(!!mailDetails?.id)
    void offerCopyOfThisDraft()
  }

  // ── Recovering ──────────────────────────────────────────────────────────────────────────────

  // A local copy of the very draft just opened, written on the id it opened with or an earlier one,
  // so the server hasn't moved on: the copy is the newer. It is only offered: the writer may have
  // meant to leave it. One another tab is still working on isn't this tab's to offer.
  const recoverableCopy = ref<DraftCopy>()
  const offerCopyOfThisDraft = async () => {
    const owner = copyUser()
    if (!owner || !mailDetails?.id || mailDetails.restored) return
    const copy = findDraftCopy(owner, draftAccount(), mailDetails.id)
    if (!copy || (await heldDraftCopyKeys()).has(copy.key)) return
    recoverableCopy.value = copy
  }
  const restoreCopy = () => {
    const copy = recoverableCopy.value
    if (!copy) return
    recoverableCopy.value = undefined
    withdrawDraftCopyOffer(copy.key)
    Object.assign(mail, copy.mail, { draft_key: copy.key })
    void saver.saveNow()
  }
  const ignoreCopy = () => {
    const copy = recoverableCopy.value
    if (!copy) return
    recoverableCopy.value = undefined
    withdrawDraftCopyOffer(copy.key)
    removeDraftCopy(copy.user, copy.account, copy.key)
  }

  /**
   * The draft this was written on is gone: sent or discarded elsewhere, or saved over by another tab.
   * The writing is still on screen, and still in the local copy. Keeping it makes a new draft, so
   * nothing written elsewhere is overwritten and both stay in Drafts.
   */
  const detachFromGoneDraft = () => {
    dropCopy()
    formerIds.clear()
    savedIn = ''
    mail.id = ''
    // The server knows the old key as the draft that went away.
    mail.draft_key = newDraftKey()
    // A draft opened from the list carries its own message id here rather than what it answers,
    // and the conversation it was written against may not be there any more.
    if (mailDetails?.id) {
      mail.in_reply_to = ''
      mail.in_reply_to_id = ''
      mail.forwarded_from_id = ''
    }
  }
  const keepAsNewDraft = () => {
    detachFromGoneDraft()
    return saver.startOver()
  }

  // The Undo toast lives for the period the server actually held delivery for (it echoes it back
  // with the send result; the hold is that plus a few seconds' grace, so a last-moment Undo still
  // lands in time). The user's own setting is only a fallback for a result without one: the
  // setting can change under a mounted composer (Settings, Desk, another tab), and a toast timed
  // from a stale copy would either vanish early or offer an Undo the server can no longer honour.
  const undoSendWindowMs = (period?: number | null) =>
    (period ?? undoSendPeriodOf(user.data)) * 1000

  // A plain Send holds delivery for the undo window ('undo'); Schedule send passes an explicit time
  // ('scheduled'). Both come back as 'Submitted' with a send_at, so the toast has to know which one
  // it confirms — and which account it went out as. The scope follows the active account, and the
  // hold is long enough to switch accounts in, so an undo names the account pinned at send time
  // rather than whichever the scope has moved on to.
  const sendMode = ref<'undo' | 'scheduled'>('undo')
  let sentAs = scopeAccountId.value
  const sendMail = async (sendAt?: string) => {
    if (isSending.value) return
    options.commitTypedRecipients?.()
    if (saver.status.value === 'gone') {
      const message = __('This draft is no longer there. Keep it as a new draft to send it.')
      if (sendAt) throw new Error(message)
      return raiseToast(message, 'error')
    }
    if (isUploading.value) {
      const message = __('Please wait for attachments to finish uploading.')
      if (sendAt) throw new Error(message)
      return raiseToast(message, 'error')
    }
    if (isRecipientsEmpty.value) {
      const message = __('Please add at least one recipient.')
      if (sendAt) throw new Error(message)
      return raiseToast(message, 'error')
    }
    sendMode.value = sendAt ? 'scheduled' : 'undo'
    isSending.value = true
    // Nothing on screen can change from here: see `isSending` in the hosts. The write carries the
    // text itself, in one step with the submission, so what goes is what the writer is looking at
    // even with a save under way or failing.
    await saver.hold()
    try {
      sentAs = draftAccount()
      if (mail.id)
        await updateDraftSubmit({
          submit: true,
          send_at: sendAt,
          undo_send: !sendAt,
        })
      else
        await createMailSubmit({
          save_as_draft: false,
          send_at: sendAt,
          undo_send: !sendAt,
        })
      // Sent, so there's nothing left to keep.
      dropCopy()
      finish()
      close()
    } catch (error) {
      saver.resume(error)
      reportNotSent(error)
      if (sendAt) throw error /* Keep the composer open after refusal. */
    } finally {
      isSending.value = false
    }
  }
  const reportNotSent = (error: unknown) => {
    const result = classifySaveError(error, navigator.onLine)
    if (result.kind === 'gone')
      raiseToast(__('Not sent. This draft was sent, discarded or changed somewhere else.'), 'error')
    else if (result.kind === 'offline') raiseToast(__("Not sent. You're offline."), 'error')
    else if (result.kind === 'unavailable')
      raiseToast(__('Not sent. Could not reach the server.'), 'error')
    else raiseToast(__('Not sent. {0}', [result.message]), 'error')
    host()?.editor?.commands.focus()
  }
  // The composer is gone and its last save did not land. It is still trying, and the draft lives in
  // this copy and on the device until it does. The toast offers it back meanwhile.
  const keepUnsavedDraft = () => {
    const draft: ComposeMailData = JSON.parse(JSON.stringify(mail))
    const account = scopeAccountId.value
    unsavedToast = toast.error(__('Draft not saved.'), {
      description: isCopyKept.value
        ? __('Kept on this device until it saves or you reopen it.')
        : __('Your changes are kept here until you reopen the draft.'),
      duration: Infinity,
      action: {
        label: __('Reopen'),
        onClick: () => {
          takeBack()
          requestCompose({ ...draft, account, restored: true })
        },
      },
    })
  }
  // Discarding closes the composer at once and offers Undo; the draft is deleted only once the
  // toast has passed (see commitAfterUndo). Undo reopens it, as it was, in the compose window — the
  // composer that held it is gone, and nothing on the server has changed.
  const discardMail = async () => {
    isDiscarding.value = true
    await saver.hold()
    // Nothing of it left on the server, so there is nothing there to remove.
    if (saver.status.value === 'gone') detachFromGoneDraft()
    dropCopy()
    finish()
    const draft: ComposeMailData = JSON.parse(JSON.stringify(mail))
    const account = scopeAccountId.value
    // Discarded from a thread, it comes back to that thread on Undo — not into a composer window.
    // Read before the composer closes: the last draft in Drafts takes the pane back to the list,
    // and Undo returns it here.
    const thread = isInThread && draft.id ? router.currentRoute.value.fullPath : undefined
    options.onDiscardUnsaved?.()
    options.onDiscardStarted?.()
    close()
    isDiscarding.value = false
    // Nothing written: no toast and nothing to undo. One already autosaved (a body that is only the
    // signature still saves) goes quietly.
    if (isUntouched.value) {
      if (draft.id)
        void client
          .mutation(api.mail.messages.deleteDraft, { account, id: draft.id })
          .then(requestListReload, () => {})
      return
    }
    // Off every list now, like a discard from the list itself; back on Undo.
    const heldIds = draft.id ? [draft.id, ...formerIds] : []
    heldIds.forEach(holdDraft)
    commitAfterUndo({
      message: __('Draft discarded.'),
      // A draft never saved has nothing on the server to remove: only Undo's reopening matters.
      removal: draft.id
        ? { kind: 'draft', account, id: draft.id }
        : { kind: 'messages', names: [] },
      onSent: requestListReload,
      restore: () => {
        if (thread) {
          // Under whichever id the list still has it, it reopens as the editor had it — and the
          // list is brought up to date, off the ids the saves have since replaced.
          const copy = { ...draft, account, restored: true }
          heldIds.forEach((id) => restoreDraft(id, copy))
          requestListReload()
          if (router.currentRoute.value.fullPath !== thread) void router.push(thread)
          return
        }
        heldIds.forEach(releaseDraft)
        requestCompose({ ...draft, account, restored: true })
      },
      // Reopening a draft needs no particular list on screen, so its Cmd/Ctrl+Z outlives the view.
      undoSlot: {
        set: (action) => setUndoAction(action, { outlivesView: true }),
        retire: retireUndoAction,
      },
    })
  }

  /** Reset the in-flight flags once the composer is off screen. */
  const onClosed = () => {
    isDiscarding.value = false
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
  // is just cancelling that submission — the message lands back in Drafts.
  const undoSend = useMutation(api.mail.scheduled.cancel)
  async function undoSendSubmit({ account, id }: { account: string; id: string }) {
    const input: InputOf<typeof api.mail.scheduled.cancel> = {
      account,
      id,
    }
    await undoSend.run(input)
    reloadMails()
    raiseToast(__('Sending undone. The message is back in your drafts.'))
  }
  const { setUndoAction, retireUndoAction } = useUndo()

  // The sent toast, with Undo on it for as long as the server holds delivery. The same undo goes in
  // the ⌘Z slot for the same time, so the key that takes back an archive takes back a send too.
  // The two are one action: whichever fires takes the toast and the slot with it, so the other
  // cannot cancel twice. When the window closes the slot is only vacated if it is still this
  // send's — a list action taken since has its own undo in there, and the toasts are its.
  //
  // It outlives the view it was sent from: cancelling a hold is a server call, as good from the
  // Outbox or the Screener as from the inbox, and looking at Sent right after sending is exactly
  // when a typo gets noticed.
  const offerUndoSend = (
    account: string,
    submissionId: string,
    windowMs: number,
    threadId?: string,
  ) => {
    const undoSendNow = () => {
      toast.dismiss(sentToast)
      retireUndoAction(undoSendNow)
      void undoSendSubmit({
        account,
        id: submissionId,
      }).catch(() => {})
    }
    setUndoAction(undoSendNow, {
      outlivesView: true,
    })
    setTimeout(() => retireUndoAction(undoSendNow), windowMs)

    // Two buttons, and they are not equals: Undo expires with the toast, so it takes the urgent
    // slot; View is an aside you could reach any time from Sent, offered only when the thread
    // isn't already the one in front of you.
    const sentToast = raiseToast(
      __('Message sent.'),
      'success',
      {
        label: __('Undo'),
        onClick: undoSendNow,
      },
      windowMs,
      threadId && route.params.threadID !== threadId
        ? {
            label: __('View'),
            onClick: () => viewSentMessage(threadId),
          }
        : undefined,
    )
  }
  const onMailUpdateSuccess = ({
    id,
    status,
    error,
    thread_id,
    submission_id,
    send_at,
    undo_send_period,
  }: OutputOf<typeof api.mail.messages.create>) => {
    if (id && mail.id && mail.id !== id) formerIds.add(mail.id)
    if (id) mail.id = id
    if (error) throw new Error(error)
    // Only these two are what was asked for. Anything else, error or not, is a mail that isn't
    // saved or sent, and must not be taken for one that is.
    if (status !== 'Drafted' && status !== 'Submitted')
      throw new Error(__('The server could not process this message.'))
    if (isDiscarding.value) return
    if (!isInThread || status === 'Submitted') reloadMails()
    // In a thread the list is where the messages come from — the pane is built from the rows the
    // list is holding, not from a fetch of its own. So a draft saved in here goes to the server
    // and the list goes on holding the version from before this sitting: leave the thread, open
    // it again, and the edits are not there. Nothing was lost; the list simply never asked again.
    //
    // It cannot be a reload on each autosave, which is why this is a debt and not a call: that
    // rebuilds the thread around the reader every couple of seconds, mid-sentence. It is settled
    // when the editor goes — see `payListDebt`.
    else if (status === 'Drafted') listOwesReload = true
    if (isOpen() && status !== 'Submitted') return
    if (status === 'Drafted') {
      // Saying so is the unsaved toast's to do, if there is one standing.
      if (unsavedToast === undefined) raiseToast(__('Draft saved.'))
    } else if (status === 'Submitted' && send_at && submission_id && sendMode.value === 'undo')
      offerUndoSend(
        sentAs,
        submission_id,
        undoSendWindowMs(undo_send_period),
        thread_id ?? undefined,
      )
    else if (status === 'Submitted' && send_at && sendMode.value === 'scheduled')
      raiseToast(__('Send scheduled.'), 'success', {
        label: __('View'),
        onClick: () =>
          router.push({
            name: 'mail-outbox',
            params: {
              accountId: scopeAccountId.value,
            },
          }),
      })
    else if (status === 'Submitted')
      raiseToast(
        __('Message sent.'),
        'success',
        // No View action when the sent mail's thread is already open in front of the user.
        thread_id && route.params.threadID !== thread_id
          ? {
              label: __('View'),
              onClick: () => viewSentMessage(thread_id),
            }
          : undefined,
      )
  }

  // ── Resources ───────────────────────────────────────────────────────────────────────────────

  async function createMailSubmit(
    {
      save_as_draft,
      send_at,
      undo_send,
    }: {
      save_as_draft: boolean
      send_at?: string
      undo_send?: boolean
    },
    write: WriteOptions = {},
  ) {
    const account = draftAccount()
    const input: InputOf<typeof api.mail.messages.create> = {
      account,
      from_email: mail.from_email,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      in_reply_to: mail.in_reply_to,
      in_reply_to_id: mail.in_reply_to_id,
      forwarded_from_id: mail.forwarded_from_id,
      ...processInlineImages(mail, {
        sending: !save_as_draft,
      }),
      from_name: getIdentity(mail.from_email)?._name ?? '',
      save_as_draft,
      send_at,
      undo_send,
      draft_key: mail.draft_key,
    }
    // Silent: the save state and the send's own report say what happened, once, not each retry.
    const result = await client.mutation(api.mail.messages.create, input, {
      ...write,
      silent: true,
    })
    savedIn = account
    onMailUpdateSuccess(result)
  }
  async function updateDraftSubmit(
    {
      submit,
      send_at,
      undo_send,
    }: {
      submit: boolean
      send_at?: string
      undo_send?: boolean
    },
    write: WriteOptions = {},
  ) {
    const input: InputOf<typeof api.mail.messages.updateDraft> = {
      account: draftAccount(),
      id: mail.id,
      from_email: mail.from_email,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      ...processInlineImages(mail, {
        sending: submit,
      }),
      from_name: getIdentity(mail.from_email)?._name ?? '',
      submit,
      send_at,
      undo_send,
      draft_key: mail.draft_key,
    }
    const result = await client.mutation(api.mail.messages.updateDraft, input, {
      ...write,
      silent: true,
    })
    onMailUpdateSuccess(result)
  }
  const isLoading = computed(() => saver.isWriting.value || isSending.value)

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
    mail.to.push({
      email,
      display_name,
      image,
    })
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

  const editorBody = createEditorBody()
  const editorContent = computed(() => editorBody.toEditor(mail.html_body))
  const onEditorChange = (value: string) => {
    mail.html_body = editorBody.fromEditor(value)
    dropUnmentionedRecipients()
  }
  return {
    mail,
    scope,
    scopeAccountId,
    identities,
    getIdentity,
    onOpened,
    isDraftUpdated: saver.isDirty,
    isRecipientsEmpty,
    moveRecipient,
    isBodyEmpty,
    isMailEmpty,
    isUntouched,
    isLoading,
    isSending,
    isDiscarding,
    saveState,
    isSafeToClose,
    saveDraft,
    retrySave: saver.retry,
    keepAsNewDraft,
    recoverableCopy,
    restoreCopy,
    ignoreCopy,
    isUploading,
    trackUpload,
    leave,
    handOff,
    payListDebt,
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
