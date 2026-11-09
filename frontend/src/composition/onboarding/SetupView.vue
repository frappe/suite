<!--
  The first Admin's setup wizard (spec 001 §4.1). Welcome, then one step at a
  time: workspace, Mail and an own domain (Suite Cloud only), the team,
  the command menu, and a summary. Reaching the summary completes onboarding,
  so closing the tab there does not send the Admin through the wizard again.

  A first Admin who was invited (Suite Cloud invites the person who signed up)
  opens it from their invitation, signed out. Their account comes right after
  the welcome, and it creates their mailbox, so the Mail step is left out.
-->
<script lang="ts">
export interface SetupInvitation {
  requestKey: string
  /** The work email the account gets. */
  account: string
  /** Where the invitation arrived, and where a reset link goes. */
  backupEmail: string
  /** The site's name, which a signed-out page has only from the invitation. */
  workspaceName: string
}
</script>

<script setup lang="ts">
import { Button, Combobox, ErrorMessage, Tooltip } from 'frappe-ui'
import { computed, onMounted, onUnmounted, reactive, ref, useTemplateRef } from 'vue'

import { api, client, useMutation, useQuery } from '@/api'
import { useSession } from '@/platform/session'
import { useWorkspace } from '@/platform/workspace'
import SuiteMark from '@/shell/SuiteMark.vue'
import { detectTimezone, useTimezones } from '@/shell/useTimezones'
import WorkspaceBrandingForm from '@/shell/WorkspaceBrandingForm.vue'

import AccountSetupStep from './AccountSetupStep.vue'
import AppIconView from './AppIconView.vue'
import DomainStep from './DomainStep.vue'
import InvitePeople from './InvitePeople.vue'
import MailStep from './MailStep.vue'
import { accountHeading, MOD_KEY, type DomainState, type StepHeading } from './onboarding'
import OnboardingFrame from './OnboardingFrame.vue'
import ShortcutStep from './ShortcutStep.vue'
import { SUITE_APPS } from './suiteApps'

type Step =
  'welcome' | 'account' | 'workspace' | 'mail' | 'domain' | 'invite' | 'shortcut' | 'ready'

const { invitation } = defineProps<{
  /** The first Admin's invitation, when they arrive from it and still need an account. */
  invitation?: SetupInvitation
}>()

const session = useSession()
const { workspaceName, setWorkspace } = useWorkspace()
const mailOnboarding = useQuery(api.suite.site.mailOnboarding, () =>
  session.status.value === 'authenticated' ? {} : false,
)
// Invitations come from the mail provider, so an invited first Admin is on Suite Cloud.
const cloud = computed(() => !!invitation || mailOnboarding.data?.cloud === true)
const order = computed<Step[]>(() => {
  if (invitation)
    return ['welcome', 'account', 'workspace', 'domain', 'invite', 'shortcut', 'ready']
  return cloud.value
    ? ['welcome', 'workspace', 'mail', 'domain', 'invite', 'shortcut', 'ready']
    : ['welcome', 'workspace', 'invite', 'shortcut', 'ready']
})
const step = ref<Step>('welcome')
const index = computed(() => order.value.indexOf(step.value))

const copy = computed<Record<Step, StepHeading>>(() => ({
  account: accountHeading(accountState.value, ''),
  welcome: {
    title: __('Welcome to Frappe Suite'),
    subtitle: __('Files, documents, mail and meetings for your whole team, in one place.'),
  },
  workspace: {
    title: __('Set up your workspace'),
    subtitle: __('Make it yours with a name and logo.'),
  },
  mail: {
    title: __('Set up business Mail'),
    subtitle: __('Create your mailbox before you invite anyone.'),
  },
  domain: {
    title: __('Use your own domain'),
    subtitle: __('Optional. You can also do this later from Admin → Mail.'),
  },
  invite: {
    title: __("Let's invite your team"),
    subtitle: __('Add teammates and explore Suite together.'),
  },
  shortcut: {
    title: __('Get anywhere with {0} K', [MOD_KEY]),
    subtitle: __('Open any app, create a file or find a person, without leaving the keyboard.'),
  },
  ready: {
    title: __("You're all set!"),
    subtitle: __('Your workspace is ready. Time to dive in.'),
  },
}))
const current = computed(() => copy.value[step.value])

function next(): void {
  const following = order.value[index.value + 1]
  if (following === 'ready') finish()
  else if (following) step.value = following
}

function back(): void {
  const previous = order.value[index.value - 1]
  if (previous) step.value = previous
}

// The account, for an invited first Admin
const account = reactive({ fullName: '', password: '' })
const accountStep = useTemplateRef<InstanceType<typeof AccountSetupStep>>('accountStep')
const accountState = computed(() => accountStep.value?.state ?? 'idle')
const retryingAccount = computed(() => ['failed', 'signin-failed'].includes(accountState.value))

/** Signed in now: the workspace's name and logo, which a signed-out page does not get. */
async function onAccountReady(): Promise<void> {
  const site = await client.query(api.suite.site.get).catch(() => null)
  if (site) setWorkspace(site)
  next()
}

// Workspace
const workspaceForm = useTemplateRef<InstanceType<typeof WorkspaceBrandingForm>>('workspaceForm')
const timezone = ref(detectTimezone())
const { timezoneOptions } = useTimezones()

// Mail and the domain
const mailStep = useTemplateRef<InstanceType<typeof MailStep>>('mailStep')
const ownDomain = ref('')
const ownDomainId = ref('')
const domainState = ref<DomainState>('idle')

async function onMailReady(): Promise<void> {
  await mailOnboarding.refetch()
  next()
}

async function onDomainContinue(): Promise<void> {
  // A verified domain becomes one people can be invited on.
  if (domainState.value === 'verified') await mailOnboarding.refetch()
  next()
}

const domainSummary = computed(() => {
  if (domainState.value === 'verified') return __('{0} connected', [ownDomain.value])
  if (domainState.value === 'pending') return __('{0}: waiting for DNS records', [ownDomain.value])
  return __('Not connected')
})

// Team
const invitePeople = useTemplateRef<InstanceType<typeof InvitePeople>>('invitePeople')
const sentSummary = ref('')
const teamSummary = computed(() => sentSummary.value || __('Working solo for now'))
const inviting = computed(() => invitePeople.value?.working)

function onInvitesSent(summary: string): void {
  sentSummary.value = summary
  next()
}

function skipInvites(): void {
  next()
}

// The command menu
const learnedPalette = ref(false)

// Completion
const markOnboarded = useMutation(api.suite.site.completeOnboarding, { silent: true })
let onboarding: Promise<unknown> | undefined
const opening = ref(false)

function finish(): void {
  step.value = 'ready'
  onboarding = markOnboarded.run({ is_onboarded: true, timezone: timezone.value })
  void onboarding.catch(() => {})
}

async function openSuite(): Promise<void> {
  opening.value = true
  try {
    // Completion ran on reaching this step; run it again only if it failed.
    if (!onboarding || markOnboarded.error)
      onboarding = markOnboarded.run({ is_onboarded: true, timezone: timezone.value })
    await onboarding
  } catch {
    opening.value = false
    return
  }
  // A full load, so the router reads the finished onboarding state.
  window.location.href = '/home'
}

onMounted(() => {
  document.documentElement.style.overscrollBehavior = 'none'
})
onUnmounted(() => {
  document.documentElement.style.overscrollBehavior = ''
})
</script>

<template>
  <!-- Welcome: centred, with the mark as the hero and one action. -->
  <div
    v-if="step === 'welcome'"
    class="flex h-full flex-col items-center justify-center overflow-auto bg-surface-base px-4 pb-16"
  >
    <SuiteMark :size="60" hero />
    <h1 class="enter mt-10 text-center text-3xl-semibold text-ink-gray-9" style="--delay: 0.25s">
      {{ current.title }}
    </h1>
    <p class="enter mt-2 max-w-xs text-center text-p-base text-ink-gray-6" style="--delay: 0.33s">
      {{ current.subtitle }}
    </p>
    <ul
      class="enter mt-8 flex items-center gap-4 text-ink-gray-5"
      style="--delay: 0.41s"
      :aria-label="__('Included apps')"
    >
      <li v-for="app in SUITE_APPS" :key="app.id">
        <Tooltip :text="app.name()">
          <span class="flex" role="img" :aria-label="app.name()">
            <AppIconView :icon="app.icon" class="size-5" />
          </span>
        </Tooltip>
      </li>
    </ul>
    <Button
      class="enter mt-10 w-60"
      style="--delay: 0.5s"
      variant="solid"
      size="md"
      :label="__('Get started')"
      autofocus
      @click="next"
    />
  </div>

  <OnboardingFrame
    v-else
    :step="step"
    :title="current.title"
    :subtitle="current.subtitle"
    :total="order.length - 1"
    :current="index - 1"
    :complete="step === 'ready'"
  >
    <AccountSetupStep
      v-if="step === 'account' && invitation"
      ref="accountStep"
      v-model:full-name="account.fullName"
      v-model:password="account.password"
      :request-key="invitation.requestKey"
      :email="invitation.account"
      :backup-email="invitation.backupEmail"
      inviter=""
      :workspace-name="invitation.workspaceName || __('your workspace')"
      @done="onAccountReady"
    />

    <div v-else-if="step === 'workspace'" class="flex flex-col gap-4">
      <WorkspaceBrandingForm ref="workspaceForm" @saved="next" />
      <Combobox
        v-model="timezone"
        :options="timezoneOptions"
        variant="outline"
        :label="__('Time zone')"
        :placeholder="__('Select a time zone')"
      />
    </div>

    <template v-else-if="step === 'mail'">
      <MailStep
        v-if="mailOnboarding.data"
        ref="mailStep"
        :options="mailOnboarding.data"
        @ready="onMailReady"
      />
      <div v-else class="flex flex-col items-start gap-3">
        <ErrorMessage :message="mailOnboarding.error?.message" />
        <Button
          v-if="mailOnboarding.error"
          :label="__('Retry')"
          @click="mailOnboarding.refetch()"
        />
      </div>
    </template>

    <DomainStep
      v-else-if="step === 'domain'"
      v-model:domain="ownDomain"
      v-model:domain-id="ownDomainId"
      v-model:state="domainState"
      :supplied-domain="mailOnboarding.data?.supplied_domain ?? ''"
    />

    <InvitePeople
      v-else-if="step === 'invite'"
      ref="invitePeople"
      :cloud="cloud"
      :domains="mailOnboarding.data?.domains ?? []"
      @sent="onInvitesSent"
    />

    <ShortcutStep v-else-if="step === 'shortcut'" v-model:learned="learnedPalette" admin />

    <dl v-else class="divide-y divide-outline-gray-2 rounded-6 bg-surface-gray-2 px-4">
      <div class="flex justify-between gap-4 py-3">
        <dt class="text-base text-ink-gray-5">{{ __('Workspace') }}</dt>
        <dd class="truncate text-base text-ink-gray-8">{{ workspaceName }}</dd>
      </div>
      <template v-if="cloud">
        <div class="flex justify-between gap-4 py-3">
          <dt class="text-base text-ink-gray-5">{{ __('Mailbox') }}</dt>
          <dd class="truncate text-base text-ink-gray-8">{{ mailOnboarding.data?.account }}</dd>
        </div>
        <div class="flex justify-between gap-4 py-3">
          <dt class="text-base text-ink-gray-5">{{ __('Domain') }}</dt>
          <dd class="truncate text-base text-ink-gray-8">{{ domainSummary }}</dd>
        </div>
      </template>
      <div class="flex justify-between gap-4 py-3">
        <dt class="text-base text-ink-gray-5">{{ __('Team') }}</dt>
        <dd class="truncate text-base text-ink-gray-8">{{ teamSummary }}</dd>
      </div>
    </dl>

    <template #actions>
      <Button
        v-if="step === 'workspace'"
        data-primary
        class="w-full"
        variant="solid"
        :label="__('Continue')"
        icon-right="lucide-chevron-right"
        :loading="workspaceForm?.saving"
        :disabled="!workspaceForm?.canSave || !timezone"
        @click="workspaceForm?.save()"
      />
      <div v-else class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <Button
            variant="subtle"
            icon-left="lucide-chevron-left"
            :label="__('Back')"
            :disabled="inviting || mailStep?.working || opening"
            :class="{ invisible: step === 'account' && accountState !== 'idle' }"
            @click="back"
          />
          <div class="flex items-center gap-2">
            <Button
              v-if="step === 'account'"
              data-primary
              variant="solid"
              :label="retryingAccount ? __('Try again') : __('Create account')"
              :icon-right="retryingAccount ? undefined : 'lucide-chevron-right'"
              :loading="accountState === 'working' || accountState === 'ready'"
              :disabled="!accountStep?.canSubmit"
              @click="accountStep?.submit()"
            />
            <Button
              v-else-if="step === 'mail'"
              data-primary
              variant="solid"
              :label="mailOnboarding.data?.ready ? __('Continue') : __('Create mailbox')"
              icon-right="lucide-chevron-right"
              :loading="mailStep?.working"
              :disabled="!mailStep?.canSubmit"
              @click="mailStep?.submit()"
            />
            <template v-else-if="step === 'domain'">
              <Button
                v-if="domainState === 'idle'"
                variant="subtle"
                :label="__('Skip')"
                @click="next"
              />
              <Button
                v-if="domainState !== 'idle'"
                data-primary
                variant="solid"
                :label="domainState === 'verified' ? __('Continue') : __('Finish later')"
                icon-right="lucide-chevron-right"
                @click="onDomainContinue"
              />
            </template>
            <template v-else-if="step === 'invite'">
              <Button
                variant="subtle"
                :label="__('Skip')"
                :disabled="inviting"
                @click="skipInvites"
              />
              <Button
                data-primary
                variant="solid"
                :label="__('Send invites')"
                icon-right="lucide-chevron-right"
                :loading="inviting"
                :disabled="!invitePeople?.canSubmit"
                @click="invitePeople?.submit()"
              />
            </template>
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
        <ErrorMessage
          v-if="step === 'ready'"
          :message="markOnboarded.error ?? undefined"
          class="text-right"
        />
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
