<!--
  The reactions a message has collected, as one chip per emoji, and the way to add one.

  A reaction is a mail of its own, folded onto its target by the server (see collapse_reactions).
  Delivered mail can't be recalled, so the only way to take one back is the Undo on the toast, while
  the server still holds it. Pressing your own chip says so rather than appearing to do nothing.
-->
<template>
  <div v-if="groups.length || !readonly" class="flex flex-wrap items-center gap-1.5">
    <Button
      v-for="group in groups"
      :key="group.emoji"
      :variant="group.mine ? 'subtle' : 'outline'"
      :tooltip="group.who"
      :aria-pressed="group.mine"
      :disabled="readonly"
      @click="react(group.emoji)"
    >
      <span class="flex items-center gap-1">
        <span>{{ group.emoji }}</span>
        <span class="tabular-nums">{{ group.count }}</span>
      </span>
    </Button>

    <EmojiPicker v-if="!readonly" v-model="picked" v-model:reaction="shortPalette">
      <template #default="{ toggle, open }">
        <Button
          variant="ghost"
          :title="__('Add reaction')"
          :aria-label="__('Add reaction')"
          @click="openPicker(toggle, open)"
        >
          <template #icon>
            <SmilePlus class="text-ink-gray-6 size-4" />
          </template>
        </Button>
      </template>
    </EmojiPicker>
  </div>
</template>

<script setup lang="ts">
import { Button, toast } from 'frappe-ui'
import { SmilePlus } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import { api, useMutation } from '@/api'
import EmojiPicker from '@/apps/mail/components/EmojiPicker.vue'
import type { MailReaction } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useOwnEmails, useUndo } from '@/apps/mail/utils/composables'
import { groupReactions, hasReacted } from '@/apps/mail/utils/reactions'
import { undoSendPeriodOf } from '@/apps/mail/utils/undoSend'

const { reactions, mailId, account, readonly } = defineProps<{
  reactions?: MailReaction[]
  mailId: string
  account: string
  readonly?: boolean
}>()

const emit = defineEmits<{ reload: [] }>()

const ownEmails = useOwnEmails()
const { setUndoAction, retireUndoAction } = useUndo()

// What the reader just sent, shown until the thread comes back with it.
const sending = ref<MailReaction[]>([])
const shown = computed(() => [...(reactions ?? []), ...sending.value])
const groups = computed(() => groupReactions(shown.value, ownEmails.value, __))

watch(
  () => reactions,
  () => {
    sending.value = sending.value.filter(
      (reaction) => !hasReacted(reactions, reaction.emoji, ownEmails.value),
    )
  },
)

const send = useMutation(api.mail.messages.react)
const undo = useMutation(api.mail.scheduled.undoReaction)

const stopShowing = (emoji: string) => {
  sending.value = sending.value.filter((reaction) => reaction.emoji !== emoji)
}

async function react(emoji: string) {
  if (hasReacted(shown.value, emoji, ownEmails.value))
    return raiseToast(__('You already reacted with {0}.', [emoji]))

  sending.value.push({
    emoji,
    from_name: null,
    from_email: [...ownEmails.value][0] ?? null,
  })
  try {
    const result = await send.run({ account, id: mailId, emoji })
    emit('reload')
    if (result.submission_id) offerUndo(emoji, result.submission_id, result.undo_send_period)
  } catch {
    stopShowing(emoji)
    raiseToast(__('Could not react to this message.'), 'error')
  }
}

// As for a sent mail (see useComposeMail): Undo on the toast and in the ⌘Z slot for as long as the
// server holds delivery, whichever fires taking the other with it.
function offerUndo(emoji: string, submissionId: string, period?: number | null) {
  const windowMs = (period ?? undoSendPeriodOf()) * 1000
  const undoNow = () => {
    toast.dismiss(sentToast)
    retireUndoAction(undoNow)
    stopShowing(emoji)
    undo
      .run({ account, id: submissionId })
      .then(() => {
        emit('reload')
        raiseToast(__('Reaction removed.'))
      })
      .catch(() => raiseToast(__('It was already delivered, so it can’t be taken back.'), 'error'))
  }
  setUndoAction(undoNow, { outlivesView: true })
  setTimeout(() => retireUndoAction(undoNow), windowMs)
  const sentToast = raiseToast(
    __('Reacted with {0}.', [emoji]),
    'success',
    { label: __('Undo'), onClick: undoNow },
    windowMs,
  )
}

// The picker opens on the short palette each time, whichever view it was left on.
const shortPalette = ref(true)
const openPicker = (toggle: () => void, open: boolean) => {
  if (!open) shortPalette.value = true
  toggle()
}

// Cleared after every pick, so choosing the same emoji again still reaches `react`.
const picked = ref<string>()
watch(picked, (emoji) => {
  if (!emoji) return
  picked.value = undefined
  void react(emoji)
})
</script>
