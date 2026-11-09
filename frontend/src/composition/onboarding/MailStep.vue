<!--
  The first Admin's business mailbox (Suite Cloud only). The mailbox and the
  password come first, before anyone is invited, so invitations go out from a
  working address. A forgotten password is reset through the email the Admin
  signed up with, so the step names it.
-->
<script setup lang="ts">
import { Button, ErrorMessage, FormControl, Select } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, type OutputOf } from '@/api'
import { useSession } from '@/platform/session'

const { options } = defineProps<{ options: OutputOf<typeof api.suite.site.mailOnboarding> }>()
const emit = defineEmits<{ ready: [] }>()

const session = useSession()
const isAdministrator = computed(() => session.user.value?.id === 'Administrator')
const mailbox = ref(suggestedMailbox())
const domain = ref(options.domains[0] ?? '')
const password = ref('')
const failure = ref('')
const setupMail = useMutation(api.suite.site.setupMail, { silent: true })

watch(
  () => options.domains,
  (domains) => {
    if (!domains.includes(domain.value)) domain.value = domains[0] ?? ''
  },
)

const canSubmit = computed(
  () =>
    options.ready ||
    (!!mailbox.value.trim() &&
      !!domain.value &&
      password.value.length >= 8 &&
      !isAdministrator.value),
)

function suggestedMailbox(): string {
  const first = (session.user.value?.fullName ?? '').trim().split(/\s+/)[0] ?? ''
  return first.toLowerCase().replace(/[^a-z0-9._-]/g, '')
}

/** Creates the mailbox, or moves on when it is ready already. */
async function submit(): Promise<void> {
  if (options.ready) {
    emit('ready')
    return
  }
  failure.value = ''
  const result = await setupMail.run({
    address: `${mailbox.value.trim().toLowerCase()}@${domain.value}`,
    password: password.value,
  })
  if (!result.success) {
    failure.value = result.error ?? __('Business Mail setup failed. Try again.')
    return
  }
  password.value = ''
  await session.refresh()
  emit('ready')
}

defineExpose({
  canSubmit,
  working: computed(() => setupMail.isPending),
  submit,
})
</script>

<template>
  <div v-if="isAdministrator" class="flex flex-col items-start gap-3">
    <p class="text-p-base text-ink-gray-6">
      {{
        __(
          'Administrator is a recovery identity. Create a business Admin, then sign in as that person to set up Mail.',
        )
      }}
    </p>
    <Button :label="__('Open Admin')" route="/admin/users" />
  </div>

  <div v-else-if="options.ready" class="flex items-center gap-3 rounded-5 bg-surface-gray-2 p-3">
    <span class="lucide-circle-check size-5 shrink-0 text-ink-green-5" aria-hidden="true" />
    <div class="min-w-0">
      <p class="truncate text-base text-ink-gray-8">{{ options.account }}</p>
      <p class="text-sm text-ink-gray-5">{{ __('Your mailbox is ready') }}</p>
    </div>
  </div>

  <form v-else class="flex flex-col gap-4" @submit.prevent="canSubmit && submit()">
    <FormControl
      v-model="mailbox"
      type="text"
      variant="outline"
      autocomplete="username"
      :label="__('Your business email')"
      :disabled="setupMail.isPending"
    >
      <template v-if="options.domains.length === 1" #suffix>
        <span class="max-w-52 truncate text-base text-ink-gray-5">{{ `@${domain}` }}</span>
      </template>
    </FormControl>
    <Select
      v-if="options.domains.length > 1"
      v-model="domain"
      variant="outline"
      :options="options.domains.map((value) => ({ label: `@${value}`, value }))"
      :aria-label="__('Domain')"
      :disabled="setupMail.isPending"
    />
    <FormControl
      v-model="password"
      type="password"
      variant="outline"
      autocomplete="new-password"
      :label="__('Password')"
      :description="__('At least 8 characters. You sign in to Suite and mail apps with it.')"
      :disabled="setupMail.isPending"
    />
    <div class="flex items-start gap-2 rounded-4 bg-surface-gray-2 px-3 py-2.5">
      <span class="lucide-life-buoy mt-0.5 size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
      <p class="text-p-sm text-ink-gray-6">
        {{
          __('Forgot it? We send a reset link to {0}, the email you signed up with.', [
            options.backup_email,
          ])
        }}
      </p>
    </div>
    <ErrorMessage :message="failure || setupMail.error?.message" />
    <!-- Enter submits; the wizard's own button does the same. -->
    <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
  </form>
</template>
