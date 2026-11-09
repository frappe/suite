<!--
  The account an invited person creates: their name and password, then one
  request that makes their Drive, their mailbox and their account, and a sign-in.
  The name and password are models, so going back to the invitation keeps them.
-->
<script setup lang="ts">
import { ErrorMessage, FormControl } from 'frappe-ui'
import { computed, onBeforeUnmount, reactive, ref } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { useSession } from '@/platform/session'
import { TransportError } from '@/platform/transport'

import { browserAccountDefaults, firstName, splitName } from './onboarding'

const { requestKey, email, backupEmail, inviter, workspaceName } = defineProps<{
  requestKey: string
  /** The work email the Admin chose. */
  email: string
  /** Where the invitation arrived, and where a reset link goes. */
  backupEmail: string
  inviter: string
  workspaceName: string
}>()
const fullName = defineModel<string>('fullName', { required: true })
const password = defineModel<string>('password', { required: true })
const emit = defineEmits<{ done: [] }>()

const session = useSession()

type SetupStage = 'drive' | 'mailbox' | 'account'
type RowState = 'waiting' | 'working' | 'done' | 'failed'
const STAGES: readonly SetupStage[] = ['drive', 'mailbox', 'account']
/** The stage a setup error names, or nothing for an error before setup began. */
function failedStage(type: string): SetupStage | undefined {
  if (type === 'DriveSetupFailed') return 'drive'
  if (type === 'MailboxSetupFailed') return 'mailbox'
  if (type === 'AccountActivationFailed') return 'account'
  return undefined
}
/** `signin-failed`: the account exists, but signing in to it did not work, so only that is retried. */
const setupState = ref<'idle' | 'working' | 'failed' | 'ready' | 'signin-failed'>('idle')
const rows = reactive<Record<SetupStage, RowState>>({
  drive: 'waiting',
  mailbox: 'waiting',
  account: 'waiting',
})
const accountError = ref('')
const createAccount = useMutation(api.mail.public.createAccount, { silent: true })
// Signing in refetches queries, and the used invitation then reads as expired, so stop once set up.
const accountOptions = useQuery(api.mail.public.accountOptions, () =>
  ['idle', 'working', 'failed'].includes(setupState.value) ? { request_key: requestKey } : false,
)
const canSubmit = computed(() => !!fullName.value.trim() && password.value.length >= 8)
let pacing: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(pacing))

/**
 * The whole setup is one request, so the rows advance on a timer while it runs.
 * The last row waits for the answer, and a failure marks the stage that failed.
 */
function paceRows(from: number): void {
  STAGES.forEach((stage, position) => {
    if (position >= from) rows[stage] = position === from ? 'working' : 'waiting'
  })
  if (from >= STAGES.length - 1) return
  pacing = setTimeout(() => {
    if (setupState.value !== 'working') return
    rows[STAGES[from]!] = 'done'
    paceRows(from + 1)
  }, 800)
}

async function createAndSignIn(): Promise<void> {
  accountError.value = ''
  setupState.value = 'working'
  const resumeAt = Math.max(
    0,
    STAGES.findIndex((stage) => rows[stage] !== 'done'),
  )
  paceRows(resumeAt)
  try {
    await createAccount.run({
      request_key: requestKey,
      ...splitName(fullName.value),
      password: password.value,
      ...browserAccountDefaults(accountOptions.data),
    })
  } catch (error) {
    clearTimeout(pacing)
    const failed = error instanceof TransportError ? failedStage(error.type) : undefined
    if (!failed) {
      // A refusal of what was typed, such as a weak password: back to the form.
      setupState.value = 'idle'
      for (const stage of STAGES) rows[stage] = 'waiting'
      accountError.value = error instanceof Error ? error.message : String(error)
      return
    }
    const failedAt = STAGES.indexOf(failed)
    STAGES.forEach((stage, position) => {
      rows[stage] = position < failedAt ? 'done' : position === failedAt ? 'failed' : 'waiting'
    })
    setupState.value = 'failed'
    return
  }
  clearTimeout(pacing)
  for (const stage of STAGES) rows[stage] = 'done'
  await signIn()
}

async function signIn(): Promise<void> {
  accountError.value = ''
  setupState.value = 'ready'
  try {
    await session.login(email, password.value)
  } catch (error) {
    // The invitation is used now, so creating the account again would fail: retry the sign-in only.
    accountError.value = error instanceof Error ? error.message : String(error)
    setupState.value = 'signin-failed'
    return
  }
  password.value = ''
  emit('done')
}

function submit(): Promise<void> {
  return setupState.value === 'signin-failed' ? signIn() : createAndSignIn()
}

const rowLabels = computed<Record<SetupStage, { label: string; detail: string }>>(() => ({
  drive: { label: __('Drive'), detail: __('Your personal files') },
  mailbox: { label: __('Mailbox'), detail: email },
  account: { label: __('Account'), detail: __('Joining {0}', [workspaceName]) },
}))
const ROW_ICONS: Readonly<Record<RowState, string>> = {
  waiting: 'lucide-circle text-ink-gray-3',
  working: 'lucide-loader-circle animate-spin text-ink-gray-6',
  done: 'lucide-circle-check text-ink-green-5',
  failed: 'lucide-circle-x text-ink-red-4',
}

defineExpose({ state: setupState, canSubmit, submit })
</script>

<template>
  <form
    v-if="setupState === 'idle'"
    class="flex flex-col gap-4"
    @submit.prevent="canSubmit && submit()"
  >
    <div class="flex items-center gap-3 rounded-5 bg-surface-gray-2 px-3 py-2.5">
      <span class="lucide-at-sign size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-base text-ink-gray-8">{{ email }}</p>
        <p class="text-sm text-ink-gray-5">
          {{
            inviter
              ? __('Your work email, chosen by {0}', [firstName(inviter)])
              : __('Your work email')
          }}
        </p>
      </div>
    </div>
    <FormControl
      v-model="fullName"
      type="text"
      variant="outline"
      :label="__('Your name')"
      autocomplete="name"
    />
    <FormControl
      v-model="password"
      type="password"
      variant="outline"
      :label="__('Password')"
      autocomplete="new-password"
      :description="__('At least 8 characters. You sign in to Suite and mail apps with it.')"
    />
    <div class="flex items-start gap-2 rounded-4 bg-surface-gray-2 px-3 py-2.5">
      <span class="lucide-life-buoy mt-0.5 size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
      <p class="text-p-sm text-ink-gray-6">
        {{
          __('Forgot it? We send a reset link to {0}, where your invitation arrived.', [
            backupEmail,
          ])
        }}
      </p>
    </div>
    <ErrorMessage :message="accountError" />
    <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
  </form>
  <div v-else class="flex flex-col gap-3">
    <ul class="divide-y divide-outline-gray-2 rounded-6 bg-surface-gray-2 px-4" aria-live="polite">
      <li v-for="stage in STAGES" :key="stage" class="flex items-center gap-3 py-3">
        <span class="size-4 shrink-0" :class="ROW_ICONS[rows[stage]]" aria-hidden="true" />
        <span class="w-16 shrink-0 text-base text-ink-gray-5">
          {{ rowLabels[stage].label }}
        </span>
        <span
          class="min-w-0 flex-1 truncate text-right text-base"
          :class="
            rows[stage] === 'failed'
              ? 'text-ink-red-4'
              : rows[stage] === 'waiting'
                ? 'text-ink-gray-5'
                : 'text-ink-gray-8'
          "
        >
          {{ rows[stage] === 'failed' ? __("Couldn't create it") : rowLabels[stage].detail }}
        </span>
      </li>
    </ul>
    <ErrorMessage :message="accountError" />
  </div>
</template>
