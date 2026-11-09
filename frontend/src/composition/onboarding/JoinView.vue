<!--
  Onboarding for people an Admin adds (spec 001 §4.1), shorter than the Admin
  wizard: no workspace decisions, only the person's own account and the command
  menu. The pages carry the workspace's name and logo.

  People arrive one of three ways, and each starts at its own step:
  - an invitation link (`/join/<key>`): the invitation, then the account;
  - a temporary password (`/join`): sign in, then their own password;
  - signed in already (`/suite/welcome`): the password if it is still
    temporary, then the welcome steps.

  A site's first Admin is invited this way too: Suite Cloud invites the person
  who signed up. Once their account exists they leave for the site wizard
  (`/suite/setup`), which is their welcome.

  The temporary password stays in memory from the sign-in to the password
  step, so changing it needs no other proof. After a reload the password step
  asks for it again.
-->
<script setup lang="ts">
import { Avatar, Button } from 'frappe-ui'
import { computed, reactive, ref, useTemplateRef, watch } from 'vue'

import { api, client, useMutation, useQuery } from '@/api'
import { useSession } from '@/platform/session'
import SuiteMark from '@/shell/SuiteMark.vue'

import AccountSetupStep from './AccountSetupStep.vue'
import { daysUntil, firstName, isTeammate, MOD_KEY, needsSiteSetup } from './onboarding'
import OnboardingFrame from './OnboardingFrame.vue'
import PasswordStep from './PasswordStep.vue'
import ShortcutStep from './ShortcutStep.vue'
import SignInStep from './SignInStep.vue'
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
      signinEmail.value = ''
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
      signinEmail.value = data.account ?? ''
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
    // Also after a reload, when the sign-in is behind them: the track counts from the password.
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
const accountStep = useTemplateRef<InstanceType<typeof AccountSetupStep>>('accountStep')
const setupState = computed(() => accountStep.value?.state ?? 'idle')
const retrying = computed(() => ['failed', 'signin-failed'].includes(setupState.value))

/** After the account: a site that is not set up yet goes to the wizard, which is the first Admin's welcome. */
async function onAccountReady(): Promise<void> {
  // Asked again now: the page loaded before this person signed in.
  const site = await client.query(api.suite.site.get).catch(() => null)
  if (!site) {
    // Unknown: Home loads afresh, and the router picks the wizard or the welcome.
    window.location.replace('/home')
    return
  }
  if (needsSiteSetup({ isOnboarded: site.is_onboarded, canOnboard: site.can_onboard })) {
    window.location.replace('/suite/setup')
    return
  }
  next()
}

// Signing in with a temporary password, which stays in memory for the password step
const signinEmail = ref('')
const temporaryPassword = ref('')

function onSignedIn(password: string): void {
  temporaryPassword.value = password
  startSignedIn()
}

// Choosing their own password
const passwordStep = useTemplateRef<InstanceType<typeof PasswordStep>>('passwordStep')

function onPasswordSaved(): void {
  temporaryPassword.value = ''
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

      <SignInStep
        v-else-if="step === 'signin'"
        class="enter mt-8"
        style="--delay: 0.2s"
        :email="signinEmail"
        @signed-in="onSignedIn"
      />

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

    <AccountSetupStep
      v-if="step === 'account' && requestKey"
      ref="accountStep"
      v-model:full-name="account.fullName"
      v-model:password="account.password"
      :request-key="requestKey"
      :email="invitation?.account ?? ''"
      :backup-email="invitation?.backup_email ?? ''"
      :inviter="inviter"
      :workspace-name="workspaceName"
      @done="onAccountReady"
    />

    <PasswordStep
      v-else-if="step === 'password'"
      ref="passwordStep"
      :temporary-password="temporaryPassword"
      @saved="onPasswordSaved"
    />

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
          :disabled="passwordStep?.changing"
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
            :disabled="!accountStep?.canSubmit"
            @click="accountStep?.submit()"
          />
          <Button
            v-else-if="step === 'password'"
            data-primary
            variant="solid"
            :label="__('Save password')"
            icon-right="lucide-chevron-right"
            :loading="passwordStep?.working"
            :disabled="!passwordStep?.canSubmit"
            @click="passwordStep?.submit()"
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
