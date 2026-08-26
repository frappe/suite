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
                <WorkspaceBrandingForm ref="workspaceForm" @saved="step = 'invite'" />
                <Combobox
                  v-model="timezone"
                  :options="timezoneOptions"
                  variant="outline"
                  :label="__('Time zone')"
                  :placeholder="__('Select a time zone')"
                />
              </div>

              <InviteStep v-else-if="step === 'invite'" ref="inviteStep" @sent="onInvitesSent" />

              <div v-else class="flex justify-center">
                <div class="flex w-full items-center gap-3 rounded-6 bg-surface-gray-2 p-4">
                  <component
                    :is="inviteSummary ? LucideMail : LucideUser"
                    class="size-7 shrink-0 stroke-[1.5] text-ink-gray-5"
                  />
                  <div class="flex flex-col gap-1">
                    <p class="text-base text-ink-gray-8">{{ inviteSummaryLabel }}</p>
                    <p class="text-sm text-ink-gray-5">{{ __('Invite anyone later from Settings.') }}</p>
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

          <div v-else-if="step === 'invite'" class="flex items-center justify-between">
            <Button
              variant="subtle"
              icon="lucide-chevron-left"
              :label="__('Back')"
              :disabled="inviteStep?.loading"
              @click="goBack"
            />
            <div class="flex items-center gap-2">
              <Button variant="subtle" :label="__('Skip')" :disabled="inviteStep?.loading" @click="finish" />
              <Button
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
            <ErrorMessage :message="markOnboarded.error" />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type ComponentPublicInstance, type Ref } from 'vue'
import { Button, Combobox, ErrorMessage, Tooltip, createResource } from 'frappe-ui'
import LucideMail from '~icons/lucide/mail'
import LucideUser from '~icons/lucide/user'

import { SUITE_APPS, SUITE_LOGO } from '@/apps/registry'
import { setupTheme, switchTheme, systemDark, themeMode } from '@/utils/setupTheme'
import SetupProgressTrack from '@/shell/SetupProgressTrack.vue'
import WorkspaceBrandingForm from '@/shell/WorkspaceBrandingForm.vue'
import InviteStep from '@/shell/InviteStep.vue'
import { detectTimezone, useTimezones } from '@/shell/useTimezones'

const apps = SUITE_APPS
const suiteLogo = SUITE_LOGO

type Step = 'welcome' | 'workspace' | 'invite' | 'ready'

const stepOrder: Step[] = ['welcome', 'workspace', 'invite', 'ready']

const step = ref<Step>('welcome')
const stepIndex = computed(() => stepOrder.indexOf(step.value))
const trackIndex = computed(() => stepIndex.value - 1)
const timezone = ref(detectTimezone())
const { timezoneOptions } = useTimezones()
const inviteSummary = ref('')
const getStartedButton = ref<ComponentPublicInstance>()
const workspaceForm = ref<InstanceType<typeof WorkspaceBrandingForm>>()
const inviteStep = ref<InstanceType<typeof InviteStep>>()
const openSuiteButton = ref<ComponentPublicInstance>()

const stepFocus: Record<Step, Ref<ComponentPublicInstance | undefined>> = {
  welcome: getStartedButton,
  workspace: workspaceForm,
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
  welcome: { title: __('Welcome to Frappe Suite'), subtitle: __('Everything your team needs, all in one place.') },
  workspace: { title: __('Set up your workspace'), subtitle: __('Make it yours with a name and logo.') },
  invite: { title: __("Let's invite your team"), subtitle: __('Add teammates and explore Suite together.') },
  ready: { title: __("You're all set!"), subtitle: __('Your workspace is ready. Time to dive in.') },
}
const current = computed(() => copy[step.value])

const inviteSummaryLabel = computed(() => inviteSummary.value || __('Working solo for now'))

const markOnboarded = createResource({
  url: 'suite.api.account.mark_onboarded',
  makeParams: () => ({ timezone: timezone.value }),
})

function getStarted() {
  step.value = 'workspace'
}

function onInvitesSent(summary: string) {
  inviteSummary.value = summary
  finish()
}

function goBack() {
  step.value = stepOrder[stepIndex.value - 1]
}

// Setup is done once the last step is reached, not once the button is clicked,
// so closing the tab here doesn't send the user back through the wizard.
function finish() {
  step.value = 'ready'
  markOnboarded.submit().catch(() => {})
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
    if (markOnboarded.loading) await markOnboarded.promise
    else if (!markOnboarded.fetched || markOnboarded.error) await markOnboarded.submit()
  } catch {
    navigating.value = false
    return
  }
  // Full reload so the router's cached setup state refetches.
  window.location.href = '/suite'
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
