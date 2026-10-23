<template>
  <div class="relative flex h-full justify-center overflow-auto bg-surface-base pt-24 pb-14">
    <Button
      class="absolute top-4 right-4"
      variant="ghost"
      :icon="isDark ? 'lucide-sun' : 'lucide-moon-star'"
      :aria-label="__('Toggle theme')"
      @click="toggleTheme"
    />
    <div class="flex w-full max-w-sm flex-col gap-7 px-4">
      <div class="sr-only" aria-live="polite">{{ current.title }}</div>
      <div class="flex items-center justify-between">
        <div v-if="step === 'welcome'" class="size-10 shrink-0" aria-hidden="true" />
        <img
          v-else
          :src="suiteLogo"
          :alt="__('Frappe Suite logo')"
          class="size-10 shrink-0 object-contain"
          draggable="false"
        />
        <SetupProgressTrack
          v-if="step !== 'welcome'"
          :total-steps="stepOrder.length - 1"
          :current-step="trackIndex"
          :is-complete="step === 'ready'"
        />
      </div>

      <Transition name="setup-step" mode="out-in" @after-enter="focusStep">
        <div :key="step">
          <div class="flex flex-col gap-8">
            <div class="flex flex-col gap-2">
              <h1 class="text-3xl-semibold text-ink-gray-9">{{ current.title }}</h1>
              <p class="text-base text-ink-gray-6">{{ current.subtitle }}</p>
            </div>

            <div class="min-h-38">
              <div v-if="step === 'welcome'" class="flex h-full items-start justify-between">
                <Tooltip v-for="(app, i) in apps" :key="app.id" :text="app.name">
                  <img
                    :src="app.logo"
                    :alt="__('{0} logo', [app.name])"
                    class="setup-icon size-[38px] object-contain"
                    :style="{ animationDelay: `${i * 0.06}s` }"
                    draggable="false"
                  />
                </Tooltip>
              </div>

              <div v-else-if="step === 'workspace'" class="flex flex-col gap-4">
                <WorkspaceBrandingForm
                  ref="workspaceForm"
                  @saved="step = mailSetup.data?.cloud ? 'mail' : 'invite'"
                />
                <Combobox
                  v-model="timezone"
                  :options="timezoneOptions"
                  variant="outline"
                  :label="__('Time zone')"
                  :placeholder="__('Select a time zone')"
                />
              </div>

              <div v-else-if="step === 'mail'" class="flex flex-col gap-4">
                <p class="text-base text-ink-gray-6">
                  {{
                    __(
                      'Use the ready business domain supplied by Suite Cloud. Custom domains and DNS setup are optional and can be added later.',
                    )
                  }}
                </p>
                <ErrorMessage
                  :message="mailSetup.error?.message || setupMail.error?.message || setupFailure"
                />
                <template v-if="session.user.value?.id === 'Administrator'">
                  <p class="text-base text-ink-gray-6">
                    {{
                      __(
                        'Administrator is a recovery identity. Create a business Admin, then sign in as that person to complete Mail setup.',
                      )
                    }}
                  </p>
                  <Button :label="__('Open Admin')" route="/admin/users" />
                </template>
                <template v-else-if="!mailSetup.data?.ready">
                  <FormControl v-model="mailUsername" :label="__('Business email name')" />
                  <FormControl
                    v-model="mailDomain"
                    type="select"
                    :options="mailSetup.data?.domains || []"
                    :label="__('Business domain')"
                  />
                  <FormControl
                    v-model="mailPassword"
                    type="password"
                    autocomplete="new-password"
                    :label="__('Suite and Mail password')"
                    :description="__('This becomes your permanent Suite and Mail-client password.')"
                  />
                  <Button
                    :label="__('Set up business Mail')"
                    :loading="setupMail.isPending"
                    :disabled="!mailUsername || !mailDomain || !mailPassword"
                    @click="provisionMail"
                  />
                </template>
                <p v-else class="text-base text-ink-green-6">
                  {{ __('Business Mail is ready: {0}', [mailSetup.data.account || '']) }}
                </p>
                <Button
                  v-if="!mailSetup.data?.domains.length"
                  :label="__('Retry provider connection')"
                  @click="mailSetup.refetch()"
                />
              </div>
              <template v-else-if="step === 'invite'">
                <p v-if="mailSetup.data?.cloud" class="text-base text-ink-gray-6">
                  {{
                    __(
                      'After setup, invite people using their personal contact email or create accounts with one-time temporary passwords in Admin → Users.',
                    )
                  }}
                </p>
                <InviteStep v-else ref="inviteStep" @sent="onInvitesSent" />
              </template>

              <div v-else class="flex justify-center">
                <div class="flex w-full items-center gap-3 rounded-6 bg-surface-gray-2 p-4">
                  <component
                    :is="inviteSummary ? LucideMail : LucideUser"
                    class="size-7 shrink-0 stroke-[1.5] text-ink-gray-5"
                  />
                  <div class="flex flex-col gap-1">
                    <p class="text-base text-ink-gray-8">{{ inviteSummaryLabel }}</p>
                    <p class="text-sm text-ink-gray-5">
                      {{ __('Invite anyone later from Admin → Users.') }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Button
            v-if="step === 'welcome'"
            ref="getStartedButton"
            class="w-full !gap-1"
            variant="solid"
            :label="__('Get started')"
            icon-right="lucide-chevron-right"
            @click="getStarted"
          />

          <Button
            v-else-if="step === 'workspace'"
            class="w-full !gap-1"
            variant="solid"
            :label="__('Continue')"
            icon-right="lucide-chevron-right"
            :loading="workspaceForm?.saving"
            :disabled="!workspaceForm?.canSave || !timezone"
            @click="workspaceForm?.save()"
          />

          <Button
            v-else-if="step === 'mail'"
            variant="solid"
            :label="__('Continue')"
            :disabled="!mailSetup.data?.ready"
            @click="step = 'invite'"
          />
          <div v-else-if="step === 'invite'" class="flex items-center justify-between">
            <Button
              variant="subtle"
              icon="lucide-chevron-left"
              :label="__('Back')"
              :disabled="inviteStep?.loading"
              @click="goBack"
            />
            <div class="flex items-center gap-2">
              <Button
                variant="subtle"
                :label="__('Skip')"
                :disabled="inviteStep?.loading"
                @click="finish"
              />
              <Button
                v-if="!mailSetup.data?.cloud"
                variant="solid"
                class="!gap-1"
                :label="__('Send invites')"
                icon-right="lucide-chevron-right"
                :loading="inviteStep?.loading"
                :disabled="!inviteStep?.canSubmit"
                @click="inviteStep?.submit()"
              />
            </div>
          </div>

          <div v-else class="flex flex-col items-end gap-2">
            <div class="flex w-full items-center justify-between">
              <Button
                variant="subtle"
                icon="lucide-chevron-left"
                :label="__('Back')"
                :disabled="navigating"
                @click="goBack"
              />
              <Button
                ref="openSuiteButton"
                variant="solid"
                class="!gap-1"
                :label="__('Open Suite')"
                icon-right="lucide-chevron-right"
                :loading="navigating"
                @click="openSuite"
              />
            </div>
            <ErrorMessage
              :message="markOnboarded.error instanceof Error ? markOnboarded.error : undefined"
            />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import LucideMail from '~icons/lucide/mail'
import LucideUser from '~icons/lucide/user'
import { Button, Combobox, ErrorMessage, FormControl, Tooltip } from 'frappe-ui'
import { computed, onMounted, onUnmounted, ref, type ComponentPublicInstance, type Ref } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import {
  calendarLogo,
  driveLogo,
  mailLogo,
  meetLogo,
  sheetsLogo,
  slidesLogo,
  suiteLogo,
  writerLogo,
} from '@/platform/brand'
import { useSession } from '@/platform/session'
import InviteStep from '@/shell/InviteStep.vue'
import SetupProgressTrack from '@/shell/SetupProgressTrack.vue'
import { detectTimezone, useTimezones } from '@/shell/useTimezones'
import WorkspaceBrandingForm from '@/shell/WorkspaceBrandingForm.vue'
import { setupTheme, switchTheme, systemDark, themeMode } from '@/utils/setupTheme'

// The welcome step's row of product marks.
const apps = [
  { id: 'drive', name: 'Drive', logo: driveLogo },
  { id: 'slides', name: 'Slides', logo: slidesLogo },
  { id: 'writer', name: 'Writer', logo: writerLogo },
  { id: 'sheets', name: 'Sheets', logo: sheetsLogo },
  { id: 'meet', name: 'Meet', logo: meetLogo },
  { id: 'mail', name: 'Mail', logo: mailLogo },
  { id: 'calendar', name: 'Calendar', logo: calendarLogo },
]

type Step = 'welcome' | 'workspace' | 'mail' | 'invite' | 'ready'

const stepOrder = computed<Step[]>(() =>
  mailSetup.data?.cloud
    ? ['welcome', 'workspace', 'mail', 'invite', 'ready']
    : ['welcome', 'workspace', 'invite', 'ready'],
)

const step = ref<Step>('welcome')
const stepIndex = computed(() => stepOrder.value.indexOf(step.value))
const trackIndex = computed(() => stepIndex.value - 1)
const timezone = ref(detectTimezone())
const { timezoneOptions } = useTimezones()
const inviteSummary = ref('')
const getStartedButton = ref<ComponentPublicInstance>()
const workspaceForm = ref<InstanceType<typeof WorkspaceBrandingForm>>()
const inviteStep = ref<InstanceType<typeof InviteStep>>()
const openSuiteButton = ref<ComponentPublicInstance>()

// Only the root element matters here, and each step's component has its own
// instance type, so the map names just that part.
const stepFocus: Record<Step, Readonly<Ref<{ $el: Node | undefined } | undefined>>> = {
  welcome: getStartedButton,
  workspace: workspaceForm,
  mail: workspaceForm,
  invite: inviteStep,
  ready: openSuiteButton,
}

function focusStep() {
  // Label-less controls render as fragments, so $el can be a comment node.
  const node: Node | undefined = stepFocus[step.value].value?.$el
  const root = node instanceof Element ? node : node?.parentElement
  if (!root) return
  const target = root.matches('button, input, textarea')
    ? (root as HTMLElement)
    : root.querySelector<HTMLElement>('input:not([type="file"]), textarea')
  target?.focus()
}

onMounted(() => {
  setupTheme()
  focusStep()
  document.documentElement.style.overscrollBehavior = 'none'
})

onUnmounted(() => {
  document.documentElement.style.overscrollBehavior = ''
})

const copy: Record<Step, { title: string; subtitle: string }> = {
  welcome: {
    title: __('Welcome to Frappe Suite'),
    subtitle: __('Everything your team needs, all in one place.'),
  },
  workspace: {
    title: __('Set up your workspace'),
    subtitle: __('Make it yours with a name and logo.'),
  },
  invite: {
    title: __("Let's invite your team"),
    subtitle: __('Add teammates and explore Suite together.'),
  },
  mail: {
    title: __('Set up business Mail'),
    subtitle: __('Your first Admin needs a ready Mail account before business setup completes.'),
  },
  ready: {
    title: __("You're all set!"),
    subtitle: __('Your workspace is ready. Time to dive in.'),
  },
}
const current = computed(() => copy[step.value])

const inviteSummaryLabel = computed(() => inviteSummary.value || __('Working solo for now'))

const markOnboarded = useMutation(api.suite.site.completeOnboarding, { silent: true })
let onboarding: Promise<unknown> | undefined

function getStarted() {
  step.value = 'workspace'
}

function onInvitesSent(summary: string) {
  inviteSummary.value = summary
  finish()
}

function goBack() {
  step.value = stepOrder.value[stepIndex.value - 1]
}

const session = useSession()
const mailSetup = useQuery(api.suite.site.mailOnboarding)
const setupMail = useMutation(api.suite.site.setupMail)
const mailUsername = ref('')
const mailDomain = ref('')
const mailPassword = ref('')
const setupFailure = ref('')
async function provisionMail() {
  const result = await setupMail.run({
    address: `${mailUsername.value}@${mailDomain.value}`,
    password: mailPassword.value,
  })
  mailPassword.value = ''
  setupFailure.value = result.error || ''
  if (result.success) {
    await session.refresh()
    await mailSetup.refetch()
  }
}

// Setup is done once the last step is reached, not once the button is clicked,
// so closing the tab here doesn't send the user back through the wizard.
function finish() {
  step.value = 'ready'
  onboarding = markOnboarded.run({ is_onboarded: true, timezone: timezone.value })
  void onboarding.catch(() => {})
}

const isDark = computed(() =>
  themeMode.value === 'automatic' ? systemDark.value : themeMode.value === 'dark',
)

function toggleTheme() {
  switchTheme(isDark.value ? 'light' : 'dark')
}

const navigating = ref(false)

async function openSuite() {
  navigating.value = true
  // Completion already ran on reaching this step; only retry if it's unfinished.
  try {
    if (!onboarding || markOnboarded.error)
      onboarding = markOnboarded.run({ is_onboarded: true, timezone: timezone.value })
    await onboarding
  } catch {
    navigating.value = false
    return
  }
  // Full reload so the router's cached setup state refetches.
  window.location.href = '/home'
}
</script>

<style scoped>
.setup-icon {
  opacity: 0;
  animation: iconIn 0.6s ease both;
}

@keyframes iconIn {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.setup-step-enter-active,
.setup-step-leave-active {
  transition: opacity 75ms ease;
}

.setup-step-enter-from,
.setup-step-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .setup-icon {
    animation: none;
    opacity: 1;
    transform: none;
  }

  .setup-step-enter-active,
  .setup-step-leave-active {
    transition: none;
  }
}
</style>
