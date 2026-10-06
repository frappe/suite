<template>
  <div ref="root" class="flex flex-col gap-2">
    <FormControl
      v-model="emails"
      type="textarea"
      variant="outline"
      :autofocus="autofocus"
      :rows="3"
      class="resize-none"
      :placeholder="__('name@company.com, another@company.com')"
      :description="description"
      :disabled="invite.isPending"
      @keydown.enter="submitOnEnter"
    />
    <ErrorMessage :message="displayError" />
  </div>
</template>

<script setup lang="ts">
import { ErrorMessage, FormControl } from 'frappe-ui'
import { computed, nextTick, onMounted, ref } from 'vue'

import { api, useMutation } from '@/api'
import { TransportError } from '@/platform/transport'

const props = defineProps<{ prefill?: string; autofocus?: boolean; description?: string }>()
const emit = defineEmits<{ sent: [summary: string] }>()

const root = ref<HTMLElement>()
const emails = ref(props.prefill || '')

// The Dialog's [autofocus] handling focuses and select()s the textarea in a
// rAF queued before this one; collapse that selection so the caret lands at
// the end of the prefilled text instead.
onMounted(async () => {
  if (!props.autofocus) return
  await nextTick()
  requestAnimationFrame(() => {
    const textarea = root.value?.querySelector('textarea')
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  })
})

const clientError = ref('')

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

const splitEmails = (s: string) =>
  s
    .split(/[\n,]+/)
    .map((e) => e.trim())
    .filter(Boolean)

const canSubmit = computed(() => splitEmails(emails.value).some(isEmail))

const invite = useMutation(api.suite.invitations.create, { silent: true })
const displayError = computed(() => {
  if (clientError.value) return clientError.value
  const error = invite.error
  if (error instanceof TransportError && error.type === 'OutgoingEmailError')
    return __('Outgoing email account not set up.')
  return error?.message ?? ''
})

async function submit() {
  if (!canSubmit.value || invite.isPending) return
  clientError.value = ''
  const cleaned = splitEmails(emails.value)
  const invalid = cleaned.filter((e) => !isEmail(e))
  if (invalid.length) {
    clientError.value =
      invalid.length === 1
        ? __('"{0}" doesn\'t look like a valid email address.', [invalid[0]])
        : __("These don't look like valid email addresses: {0}", [invalid.join(', ')])
    return
  }
  await invite.run({ emails: cleaned.join(', ') })
  const count = new Set(cleaned).size
  const summary = count === 1 ? __("We'll send 1 invite") : __("We'll send {0} invites", [count])
  emails.value = ''
  emit('sent', summary)
}

function submitOnEnter(e: KeyboardEvent) {
  if (!e.metaKey && !e.ctrlKey) return
  e.preventDefault()
  return submit()
}

defineExpose({
  submit,
  canSubmit,
  loading: computed(() => invite.isPending),
})
</script>
