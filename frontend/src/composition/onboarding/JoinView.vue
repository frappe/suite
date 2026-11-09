<!--
  Onboarding for people an Admin adds (spec 001 §4.1), shorter than the Admin
  wizard: no workspace decisions, only the person's own account and the command
  menu. The pages carry the workspace's name and logo.

  People arrive one of three ways, and each starts at its own step:
  - an invitation link (`/join/<key>`): the invitation, then the account;
  - a temporary password (`/join`): sign in, then their own password;
  - signed in already (`/suite/welcome`, `/suite/change-password`): the
    password if it is still temporary, then the welcome steps.

  The temporary password stays in memory from the sign-in to the password
  step, so changing it needs no other proof. After a reload the password step
  asks for it again.
-->
<script setup lang="ts">
import { Avatar, Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

import { api, client, useMutation, useQuery } from '@/api'
import { toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { TransportError } from '@/platform/transport'
import SuiteMark from '@/shell/SuiteMark.vue'

import {
  browserAccountDefaults,
  daysUntil,
  firstName,
  isEmail,
  isTeammate,
  MOD_KEY,
  splitName,
} from './onboarding'
import OnboardingFrame from './OnboardingFrame.vue'
import ShortcutStep from './ShortcutStep.vue'
import WorkspaceMark from './WorkspaceMark.vue'

type Step =
  'loading' | 'invitation' | 'expired' | 'account' | 'signin' | 'password' | 'shortcut' | 'ready'

const { requestKey } = defineProps<{ requestKey?: string }>()

const session = useSession()
const workspace = useQuery(api.suite.site.workspace)
const invitationQuery = useQuery(api.mail.public.accountRequest, () =>
  requestKey && session.status.value === 'guest' ? { request_key: requestKey } : false,
)
const invitation = computed(() => invitationQuery.data ?? null)
const workspaceName = computed(
  () => invitation.value?.workspace_name || workspace.data?.workspace_name || __('your workspace'),
)
const workspaceLogo = computed(
  () => invitation.value?.workspace_logo || workspace.data?.workspace_logo || null,
)
const inviter = computed(() => invitation.value?.invited_by_name || '')

const step = ref<Step>('loading')
/** How this person arrived, which sets the steps the track counts. */
const arrival = ref<'invitation' | 'temporary-password' | 'signed-in'>('signed-in')
const order = computed<Step[]>(() => {
  if (arrival.value === 'invitation') return ['invitation', 'account', 'shortcut', 'ready']
  if (arrival.value === 'temporary-password') return ['signin', 'password', 'shortcut', 'ready']
  return ['shortcut', 'ready']
})
const index = computed(() => order.value.indexOf(step.value))
const centred = computed(() => ['loading', 'invitation', 'expired', 'signin'].includes(step.value))

// Where to start, once the session (and an invitation) has loaded. Vue Router keeps this
// view when the address moves between /join/<key> and /join, so a new key starts over.
let startedFor = requestKey
watch(
  [() => requestKey, () => session.status.value, () => invitationQuery.status],
  () => {
    if (requestKey !== startedFor) {
      startedFor = requestKey
      step.value = 'loading'
      arrival.value = 'signed-in'
      signin.email = ''
    }
    if (step.value !== 'loading') return
    if (session.status.value === 'loading') return
    if (session.status.value === 'authenticated') {
      startSignedIn()
      return
    }
    if (!requestKey) {
      arrival.value = 'temporary-password'
      step.value = 'signin'
      return
    }
    if (invitationQuery.status === 'error') step.value = 'expired'
    if (invitationQuery.status !== 'success') return
    const data = invitation.value
    if (data?.is_verified) {
      // Accepted already: sign in with the business address.
      signin.email = data.account ?? ''
      arrival.value = 'temporary-password'
      step.value = 'signin'
    } else if (!data || data.is_expired || !(data.account || data.backup_email)) {
      step.value = 'expired'
    } else {
      arrival.value = 'invitation'
      step.value = 'invitation'
    }
  },
  { immediate: true },
)

function startSignedIn(): void {
  const user = session.user.value
  if (user?.must_change_password === true) {
    // After a reload: the sign-in is behind them, so the track counts from the password.
    arrival.value = 'temporary-password'
    step.value = 'password'
  } else if (user?.needs_welcome === true) {
    step.value = 'shortcut'
  } else {
    window.location.replace('/home')
  }
}

function next(): void {
  const following = order.value[index.value + 1]
  if (!following) return
  step.value = following
  if (following === 'ready') finishWelcome()
}

function back(): void {
  const previous = order.value[index.value - 1]
  if (previous) step.value = previous
}

// The account, from an invitation
const account = reactive({ fullName: '', password: '' })
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
  step.value === 'account' && ['idle', 'working', 'failed'].includes(setupState.value) && requestKey
    ? { request_key: requestKey }
    : false,
)
const retrying = computed(() => ['failed', 'signin-failed'].includes(setupState.value))
const accountReady = computed(() => !!account.fullName.trim() && account.password.length >= 8)
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

async function submitAccount(): Promise<void> {
  if (!requestKey || !invitation.value) return
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
      ...splitName(account.fullName),
      password: account.password,
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
  await signInToAccount()
}

async function signInToAccount(): Promise<void> {
  accountError.value = ''
  setupState.value = 'ready'
  try {
    await session.login(invitation.value?.account ?? '', account.password)
  } catch (error) {
    // The invitation is used now, so creating the account again would fail: retry the sign-in only.
    accountError.value = error instanceof Error ? error.message : String(error)
    setupState.value = 'signin-failed'
    return
  }
  account.password = ''
  next()
}

const rowLabels = computed<Record<SetupStage, { label: string; detail: string }>>(() => ({
  drive: { label: __('Drive'), detail: __('Your personal files') },
  mailbox: { label: __('Mailbox'), detail: invitation.value?.account ?? '' },
  account: { label: __('Account'), detail: __('Joining {0}', [workspaceName.value]) },
}))
const ROW_ICONS: Readonly<Record<RowState, string>> = {
  waiting: 'lucide-circle text-ink-gray-3',
  working: 'lucide-loader-circle animate-spin text-ink-gray-6',
  done: 'lucide-circle-check text-ink-green-5',
  failed: 'lucide-circle-x text-ink-red-4',
}

// Signing in with a temporary password
const signin = reactive({ email: '', password: '' })
const signingIn = ref(false)
const signinError = ref('')
let temporaryPassword = ''

async function submitSignin(): Promise<void> {
  signingIn.value = true
  signinError.value = ''
  try {
    await session.login(signin.email.trim(), signin.password)
  } catch (error) {
    signinError.value = error instanceof Error ? error.message : String(error)
    return
  } finally {
    signingIn.value = false
  }
  temporaryPassword = signin.password
  signin.password = ''
  const user = session.user.value
  if (user?.must_change_password === true) {
    step.value = 'password'
  } else if (user?.needs_welcome === true) {
    step.value = 'shortcut'
  } else {
    window.location.replace('/home')
  }
}

// Choosing their own password
const passwordForm = reactive({ temporary: '', password: '', backupEmail: '' })
const needsTemporary = computed(() => step.value === 'password' && !temporaryPassword)
const passwordReady = computed(
  () =>
    passwordForm.password.length >= 8 &&
    (!needsTemporary.value || !!passwordForm.temporary) &&
    (!passwordForm.backupEmail.trim() || isEmail(passwordForm.backupEmail)),
)
const changePassword = useMutation(api.suite.account.changePassword, { silent: true })
const saveCredentials = useMutation(api.mail.settings.updateCredentials, { silent: true })

async function submitPassword(): Promise<void> {
  await changePassword.run({
    old_password: temporaryPassword || passwordForm.temporary,
    new_password: passwordForm.password,
  })
  temporaryPassword = ''
  passwordForm.temporary = passwordForm.password = ''
  await session.refresh()
  const backupEmail = passwordForm.backupEmail.trim()
  if (backupEmail) {
    try {
      const credentials = await client.query(api.mail.settings.credentials)
      await saveCredentials.run({ username: credentials.username, backup_email: backupEmail })
    } catch {
      toast.error(__('Your password is saved, but the backup email is not. Add it in Settings.'))
    }
  }
  next()
}

async function signOut(): Promise<void> {
  await session.logout()
  window.location.href = '/join'
}

// The command menu, and the end
const learnedPalette = ref(false)
const completeWelcome = useMutation(api.suite.account.update, { silent: true })
let welcomed: Promise<unknown> | undefined
const opening = ref(false)

function finishWelcome(): void {
  welcomed = completeWelcome.run({ welcomed: true })
  void welcomed.catch(() => {})
}

async function openSuite(): Promise<void> {
  opening.value = true
  try {
    if (!welcomed || completeWelcome.error) welcomed = completeWelcome.run({ welcomed: true })
    await welcomed
  } catch {
    opening.value = false
    return
  }
  window.location.href = '/home'
}

const people = useQuery(api.suite.people.list, () => (step.value === 'ready' ? {} : false))
const teammates = computed(() =>
  (people.data?.rows ?? []).filter((row) => isTeammate(row, session.user.value?.id)),
)
const teamLabel = computed(() => {
  const [first, ...rest] = teammates.value
  if (!first) return ''
  const name = firstName(first.full_name || first.email)
  return rest.length
    ? rest.length === 1
      ? __('{0} and 1 other', [name])
      : __('{0} and {1} others', [name, rest.length])
    : name
})
const isAdmin = computed(() => !!session.capabilities.value.suiteAdmin)
const roleLabel = (admin: boolean) => (admin ? __('Admin') : __('Normal User'))

// Copy
const expiresIn = computed(() => {
  const at = invitation.value?.expires_at
  if (!at) return ''
  const days = daysUntil(at)
  return days <= 1 ? __('Expires within a day.') : __('Expires in {0} days.', [days])
})

const copy = computed(() => {
  const admin = inviter.value
  switch (step.value) {
    case 'invitation':
      return {
        title: __('Join {0} on Frappe Suite', [workspaceName.value]),
        subtitle: admin
          ? __('{0} invited you to work together on files, mail and meetings.', [admin])
          : __('You are invited to work together on files, mail and meetings.'),
      }
    case 'expired':
      return invitation.value
        ? {
            title: __('This invitation has expired'),
            subtitle: __('Invitations to {0} last 7 days. Ask {1} to send you a new one.', [
              workspaceName.value,
              admin || __('your Admin'),
            ]),
          }
        : {
            title: __('This invitation link does not work'),
            subtitle: __(
              'It may have been replaced by a newer one. Ask your Admin to send it again.',
            ),
          }
    case 'signin':
      return {
        title: __('Sign in to {0}', [workspaceName.value]),
        subtitle: __('Use your work email and the temporary password your Admin gave you.'),
      }
    case 'account':
      return {
        idle: {
          title: __('Create your account'),
          subtitle: __('Your name is what teammates see.'),
        },
        working: {
          title: __('Setting up your account'),
          subtitle: __('This takes a few seconds.'),
        },
        failed: {
          title: __("Setup didn't finish"),
          subtitle: __('Nothing you entered is lost. Try again, or tell {0} if it keeps failing.', [
            admin ? firstName(admin) : __('your Admin'),
          ]),
        },
        ready: { title: __('Your account is ready'), subtitle: __('One moment.') },
        'signin-failed': {
          title: __('Your account is ready'),
          subtitle: __('Sign in to continue.'),
        },
      }[setupState.value]
    case 'password':
      return {
        title: __('Choose your own password'),
        subtitle: __('Your Admin set a temporary one for you. Replace it to continue.'),
      }
    case 'shortcut':
      return {
        title: __('Get anywhere with {0} K', [MOD_KEY]),
        subtitle: __('Open any app, create a file or find a person, without leaving the keyboard.'),
      }
    case 'ready':
      return {
        title: __('Welcome to {0}, {1}', [
          workspace.data?.workspace_name || workspaceName.value,
          firstName(session.user.value?.fullName ?? ''),
        ]),
        subtitle: __('Your account is ready.'),
      }
    default:
      return { title: '', subtitle: '' }
  }
})
</script>

<template>
  <!-- Arrival pages: centred, in the workspace's name. -->
  <div v-if="centred" class="flex h-full flex-col items-center overflow-auto bg-surface-base px-4">
    <div
      v-if="step !== 'loading'"
      class="flex w-full max-w-xs flex-1 flex-col items-center justify-center py-16"
    >
      <div class="enter relative">
        <WorkspaceMark
          size="lg"
          :name="workspaceName"
          :logo="workspaceLogo"
          :class="{ 'opacity-50 grayscale': step === 'expired' }"
        />
        <span
          v-if="step === 'invitation' && inviter"
          class="absolute -right-2 -bottom-2 flex rounded-full ring-[3px] ring-[var(--surface-base,#fff)]"
        >
          <Avatar :label="inviter" :image="invitation?.invited_by_image ?? undefined" size="lg" />
        </span>
      </div>

      <h1 class="enter mt-8 text-center text-3xl-semibold text-ink-gray-9" style="--delay: 0.08s">
        {{ copy.title }}
      </h1>
      <p class="enter mt-2 text-center text-p-base text-ink-gray-6" style="--delay: 0.14s">
        {{ copy.subtitle }}
      </p>

      <template v-if="step === 'invitation' && invitation">
        <dl
          class="enter mt-8 w-full divide-y divide-outline-gray-2 rounded-6 bg-surface-gray-2 px-4"
          style="--delay: 0.2s"
        >
          <div class="flex justify-between gap-4 py-3">
            <dt class="text-base text-ink-gray-5">{{ __('Your email') }}</dt>
            <dd class="truncate text-base text-ink-gray-8">{{ invitation.account }}</dd>
          </div>
          <div class="flex justify-between gap-4 py-3">
            <dt class="text-base text-ink-gray-5">{{ __('Role') }}</dt>
            <dd class="text-base text-ink-gray-8">{{ roleLabel(!!invitation.is_admin) }}</dd>
          </div>
        </dl>
        <Button
          class="enter mt-8 w-full"
          style="--delay: 0.26s"
          variant="solid"
          size="md"
          :label="__('Accept invitation')"
          autofocus
          @click="next"
        />
        <p
          class="enter mt-4 text-center text-sm sm:whitespace-nowrap text-ink-gray-5"
          style="--delay: 0.3s"
        >
          {{ __('Sent to {0}.', [invitation.backup_email ?? '']) }} {{ expiresIn }}
        </p>
      </template>

      <form
        v-else-if="step === 'signin'"
        class="enter mt-8 flex w-full flex-col gap-4"
        style="--delay: 0.2s"
        @submit.prevent="submitSignin"
      >
        <FormControl
          v-model="signin.email"
          type="email"
          variant="outline"
          :label="__('Email')"
          autocomplete="username"
          :autofocus="!signin.email"
        />
        <FormControl
          v-model="signin.password"
          type="password"
          variant="outline"
          :label="__('Password')"
          autocomplete="current-password"
          :autofocus="!!signin.email"
        />
        <ErrorMessage :message="signinError" />
        <Button
          class="mt-2 w-full"
          type="submit"
          variant="solid"
          size="md"
          :label="__('Sign in')"
          :loading="signingIn"
          :disabled="!isEmail(signin.email) || !signin.password"
        />
        <p class="text-center text-sm text-ink-gray-5">
          {{ __('Lost it? Ask your Admin for a new temporary password.') }}
        </p>
      </form>

      <div v-else class="enter mt-8 flex w-full flex-col gap-2" style="--delay: 0.2s">
        <Button
          v-if="invitation?.invited_by_email"
          class="w-full"
          variant="solid"
          size="md"
          :label="__('Email {0}', [firstName(inviter)])"
          :href="`mailto:${invitation.invited_by_email}`"
        />
        <Button
          class="w-full"
          variant="ghost"
          size="md"
          :label="__('I already joined. Sign in')"
          route="/join"
        />
      </div>
    </div>

    <footer v-if="step !== 'loading'" class="flex items-center gap-2 pb-6 text-sm text-ink-gray-5">
      <SuiteMark :size="18" />
      {{ __('Frappe Suite') }}
    </footer>
  </div>

  <!-- Steps: the same narrow column as the Admin wizard, under the workspace's mark. -->
  <OnboardingFrame
    v-else
    :step="step"
    :title="copy.title"
    :subtitle="copy.subtitle"
    :total="order.length - 1"
    :current="index - 1"
    :complete="step === 'ready'"
  >
    <template #mark>
      <WorkspaceMark :name="workspaceName" :logo="workspaceLogo" />
    </template>

    <template v-if="step === 'account'">
      <form
        v-if="setupState === 'idle'"
        class="flex flex-col gap-4"
        @submit.prevent="accountReady && submitAccount()"
      >
        <div class="flex items-center gap-3 rounded-5 bg-surface-gray-2 px-3 py-2.5">
          <span class="lucide-at-sign size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-base text-ink-gray-8">{{ invitation?.account }}</p>
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
          v-model="account.fullName"
          type="text"
          variant="outline"
          :label="__('Your name')"
          autocomplete="name"
        />
        <FormControl
          v-model="account.password"
          type="password"
          variant="outline"
          :label="__('Password')"
          autocomplete="new-password"
          :description="__('At least 8 characters. You sign in to Suite and mail apps with it.')"
        />
        <div class="flex items-start gap-2 rounded-4 bg-surface-gray-2 px-3 py-2.5">
          <span
            class="lucide-life-buoy mt-0.5 size-4 shrink-0 text-ink-gray-5"
            aria-hidden="true"
          />
          <p class="text-p-sm text-ink-gray-6">
            {{
              __('Forgot it? We send a reset link to {0}, where your invitation arrived.', [
                invitation?.backup_email ?? '',
              ])
            }}
          </p>
        </div>
        <ErrorMessage :message="accountError" />
        <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
      </form>
      <div v-else class="flex flex-col gap-3">
        <ul
          class="divide-y divide-outline-gray-2 rounded-6 bg-surface-gray-2 px-4"
          aria-live="polite"
        >
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

    <form
      v-else-if="step === 'password'"
      class="flex flex-col gap-4"
      @submit.prevent="passwordReady && submitPassword()"
    >
      <FormControl
        v-if="needsTemporary"
        v-model="passwordForm.temporary"
        type="password"
        variant="outline"
        :label="__('Temporary password')"
        autocomplete="current-password"
      />
      <FormControl
        v-model="passwordForm.password"
        type="password"
        variant="outline"
        :label="__('New password')"
        autocomplete="new-password"
        :description="__('At least 8 characters. Your temporary password stops working.')"
      />
      <FormControl
        v-model="passwordForm.backupEmail"
        type="email"
        variant="outline"
        :label="__('Backup email (optional)')"
        :placeholder="'you@gmail.com'"
        :description="
          __(
            'Where we send a reset link if you forget it. Without one, your Admin has to reset it for you.',
          )
        "
      />
      <ErrorMessage :message="changePassword.error?.message" />
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
    </form>

    <ShortcutStep
      v-else-if="step === 'shortcut'"
      v-model:learned="learnedPalette"
      :admin="isAdmin"
    />

    <dl v-else class="divide-y divide-outline-gray-2 rounded-6 bg-surface-gray-2 px-4">
      <div class="flex justify-between gap-4 py-3">
        <dt class="text-base text-ink-gray-5">{{ __('Email') }}</dt>
        <dd class="truncate text-base text-ink-gray-8">{{ session.user.value?.email }}</dd>
      </div>
      <div class="flex justify-between gap-4 py-3">
        <dt class="text-base text-ink-gray-5">{{ __('Role') }}</dt>
        <dd class="text-base text-ink-gray-8">{{ roleLabel(isAdmin) }}</dd>
      </div>
      <div v-if="teammates.length" class="flex items-center justify-between gap-4 py-3">
        <dt class="text-base text-ink-gray-5">{{ __('Team') }}</dt>
        <dd class="flex min-w-0 items-center gap-2 text-base text-ink-gray-8">
          <span class="flex shrink-0 -space-x-1.5" aria-hidden="true">
            <Avatar
              v-for="person in teammates.slice(0, 4)"
              :key="person.name"
              class="ring-2 ring-[var(--surface-gray-2)] [&>div]:bg-surface-gray-4 [&>div]:text-xs [&>div]:text-ink-gray-7"
              :label="person.full_name || person.email"
              :image="person.user_image ?? undefined"
              size="md"
            />
          </span>
          <span class="truncate">{{ teamLabel }}</span>
        </dd>
      </div>
    </dl>

    <template #actions>
      <div class="flex items-center justify-between">
        <!-- Until the temporary password is replaced, signing out is the only way off this page. -->
        <Button
          v-if="step === 'password'"
          variant="ghost"
          :label="__('Sign out')"
          :disabled="changePassword.isPending"
          @click="signOut"
        />
        <Button
          v-else-if="step === 'account' && setupState === 'idle'"
          variant="subtle"
          icon-left="lucide-chevron-left"
          :label="__('Back')"
          @click="back"
        />
        <Button
          v-else-if="step === 'ready'"
          variant="subtle"
          icon-left="lucide-chevron-left"
          :label="__('Back')"
          :disabled="opening"
          @click="back"
        />
        <span v-else />
        <div class="flex items-center gap-2">
          <Button
            v-if="step === 'account'"
            data-primary
            variant="solid"
            :label="retrying ? __('Try again') : __('Join {0}', [workspaceName])"
            :icon-right="retrying ? undefined : 'lucide-chevron-right'"
            :loading="setupState === 'working' || setupState === 'ready'"
            :disabled="!accountReady"
            @click="setupState === 'signin-failed' ? signInToAccount() : submitAccount()"
          />
          <Button
            v-else-if="step === 'password'"
            data-primary
            variant="solid"
            :label="__('Save password')"
            icon-right="lucide-chevron-right"
            :loading="changePassword.isPending || saveCredentials.isPending"
            :disabled="!passwordReady"
            @click="submitPassword"
          />
          <Button
            v-else-if="step === 'shortcut'"
            data-primary
            :variant="learnedPalette ? 'solid' : 'subtle'"
            :label="learnedPalette ? __('Continue') : __('Skip')"
            :icon-right="learnedPalette ? 'lucide-chevron-right' : undefined"
            @click="next"
          />
          <Button
            v-else
            data-primary
            variant="solid"
            :label="__('Open Suite')"
            icon-right="lucide-chevron-right"
            :loading="opening"
            @click="openSuite"
          />
        </div>
      </div>
    </template>
  </OnboardingFrame>
</template>

<style scoped>
.enter {
  animation: enter 0.7s cubic-bezier(0.16, 1, 0.3, 1) var(--delay, 0s) both;
}
@keyframes enter {
  from {
    opacity: 0;
    transform: translateY(6px);
    filter: blur(2px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .enter {
    animation: none;
  }
}
</style>
