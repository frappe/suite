<!--
  What setup leaves for later, kept at the top of Home until the person hides it.
  Admins get workspace tasks; everyone else gets only their own. Each task reads
  its real state, so a domain connected in Settings or a photo added from the
  profile ticks here too. Hiding is saved per person.
-->
<script setup lang="ts">
import { Button, Dialog } from 'frappe-ui'
import { computed, ref, useTemplateRef, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import DomainStep from '@/composition/onboarding/DomainStep.vue'
import { isTeammate, type DomainState } from '@/composition/onboarding/onboarding'
import TeamInviteStep from '@/composition/onboarding/TeamInviteStep.vue'
import { toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { openSettings } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'
import { useWorkspace } from '@/platform/workspace'
import InviteStep from '@/shell/InviteStep.vue'
import WorkspaceBrandingForm from '@/shell/WorkspaceBrandingForm.vue'

type TaskId = 'domain' | 'team' | 'import' | 'logo' | 'photo'
interface Task {
  id: TaskId
  title: string
  description: string
  done: boolean
}

const session = useSession()
const { workspaceLogo } = useWorkspace()
const admin = computed(() => session.capabilities.value.suiteAdmin === true)
const hasMail = computed(() => session.capabilities.value.jmap)

const onboarding = useQuery(api.suite.site.mailOnboarding, () => (admin.value ? {} : false))
const cloud = computed(() => onboarding.data?.cloud === true)
const domains = useQuery(api.mail.admin.domains.list, () =>
  admin.value && cloud.value ? { page_length: 100 } : false,
)
const invites = useQuery(api.mail.admin.invites.list, () =>
  admin.value && cloud.value ? { status: 'All', page_length: 20 } : false,
)
// A self-hosted site invites through Frappe, which keeps no invitation list:
// the team counts once someone else has an account.
const people = useQuery(api.suite.people.list, () => (admin.value && !cloud.value ? {} : false))
const imports = useQuery(api.mail.exchanges.list, () =>
  hasMail.value
    ? { doctype: 'Mail Exchange', operation: 'Import', status: 'Completed', page_length: 1 }
    : false,
)

// The provider supplies the first domain; any later one is the business's own.
const suppliedDomain = computed(() => {
  const rows = [...(domains.data?.items ?? [])]
  rows.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  return rows[0]?.name ?? ''
})
const ownDomain = computed(() => {
  const own = (domains.data?.items ?? []).filter((row) => row.name !== suppliedDomain.value)
  return own.find((row) => row.is_verified) ?? own[0]
})
const inviteDomains = computed(() => {
  const verified = (onboarding.data?.domains ?? []).slice()
  return verified.sort(
    (a, b) => Number(b === suppliedDomain.value) - Number(a === suppliedDomain.value),
  )
})
const teamDone = computed(() =>
  cloud.value
    ? (invites.data?.total ?? 0) > 0
    : (people.data?.rows ?? []).some((row) => isTeammate(row, session.user.value?.id)),
)

const importTask = computed<Task[]>(() =>
  hasMail.value
    ? [
        {
          id: 'import',
          title: __('Bring your old mail'),
          description: __('Import mail and contacts from another account'),
          done: (imports.data?.total ?? 0) > 0,
        },
      ]
    : [],
)

const adminTasks = computed<Task[]>(() => [
  ...(cloud.value
    ? [
        {
          id: 'domain' as const,
          title:
            ownDomain.value && !ownDomain.value.is_verified
              ? __('Finish connecting {0}', [ownDomain.value.name])
              : __('Use your own domain'),
          description: ownDomain.value?.is_verified
            ? __('{0} is connected', [ownDomain.value.name])
            : ownDomain.value
              ? __('Some DNS records are still missing')
              : __('Addresses like you@yourcompany.com'),
          done: ownDomain.value?.is_verified === true,
        },
      ]
    : []),
  {
    id: 'team',
    title: __('Invite your team'),
    description: __('Work together on files, mail and meetings'),
    done: teamDone.value,
  },
  ...importTask.value,
  {
    id: 'logo',
    title: __('Add your logo'),
    description: __('Shows in the rail, invitations and shared links'),
    done: !!workspaceLogo.value,
  },
])
const memberTasks = computed<Task[]>(() => [
  {
    id: 'photo',
    title: __('Add a profile photo'),
    description: __('So teammates recognise you'),
    done: !!session.user.value?.avatar,
  },
  ...importTask.value,
])

const tasks = computed(() => (admin.value ? adminTasks.value : memberTasks.value))
const doneCount = computed(() => tasks.value.filter((task) => task.done).length)
const allDone = computed(() => doneCount.value === tasks.value.length)
// Three tasks fit one row; any other count pairs up, so no card sits alone on a wide row.
const columns = computed(() =>
  tasks.value.length === 3 ? 'sm:grid-cols-3' : tasks.value.length > 1 ? 'sm:grid-cols-2' : '',
)
// Shown once every task knows its state, so no tick appears a moment late.
// A query that is turned off also reads as pending, so only the ones in use count.
const loaded = computed(() => {
  const inUse = [
    [onboarding, admin.value],
    [domains, admin.value && cloud.value],
    [invites, admin.value && cloud.value],
    [people, admin.value && !cloud.value],
    [imports, hasMail.value],
  ] as const
  return inUse.every(([query, used]) => !used || query.status !== 'pending')
})

const hidden = ref(session.user.value?.get_started_hidden === true)
const hide = useMutation(api.suite.account.update, { silent: true })
async function hideList(): Promise<void> {
  hidden.value = true
  try {
    await hide.run({ get_started_hidden: true })
  } catch {
    hidden.value = false
    toast.error(__('Could not hide the list. Try again.'))
  }
}

const active = ref<TaskId | null>(null)
const activeTask = computed(() => tasks.value.find((task) => task.id === active.value))
const dialogOpen = computed({
  get: () => active.value !== null,
  set: (open: boolean) => {
    if (!open) active.value = null
  },
})

function openTask(task: Task): void {
  // These live in Settings already; the list only points there.
  if (task.id === 'import') return openSettings('mail.import')
  if (task.id === 'photo') return openSettings('account.profile')
  active.value = task.id
}

// The domain dialog starts from the domain added before, if any.
const domainName = ref('')
const domainId = ref('')
const domainState = ref<DomainState>('idle')
watch(active, (task, previous) => {
  if (previous === 'domain') {
    void domains.refetch()
    void onboarding.refetch()
  }
  if (task !== 'domain') return
  const row = ownDomain.value
  domainName.value = row?.name ?? ''
  domainId.value = row?.id ?? ''
  domainState.value = row ? (row.is_verified ? 'verified' : 'pending') : 'idle'
})
const teamInvite = useTemplateRef<InstanceType<typeof TeamInviteStep>>('teamInvite')
const selfHostedInvite = useTemplateRef<InstanceType<typeof InviteStep>>('selfHostedInvite')
const inviting = computed(() => teamInvite.value?.working || selfHostedInvite.value?.loading)
const canInvite = computed(() =>
  cloud.value ? teamInvite.value?.canSubmit : selfHostedInvite.value?.canSubmit,
)
function sendInvites(): void {
  if (cloud.value) void teamInvite.value?.submit()
  else void selfHostedInvite.value?.submit()
}
function onInvited(summary: string): void {
  active.value = null
  toast.success(summary)
  void (cloud.value ? invites.refetch() : people.refetch())
}

const brandingForm = useTemplateRef<InstanceType<typeof WorkspaceBrandingForm>>('brandingForm')
</script>

<template>
  <section v-if="loaded && !hidden" aria-labelledby="home-get-started-heading">
    <div class="flex items-center justify-between gap-3 pb-3">
      <div class="flex min-w-0 items-baseline gap-2">
        <h2 id="home-get-started-heading" class="text-lg font-medium text-ink-gray-9">
          {{ allDone ? __("You're all set") : __('Get started') }}
        </h2>
        <span class="text-sm tabular-nums text-ink-gray-5">
          {{ __('{0} of {1} done', [doneCount, tasks.length]) }}
        </span>
      </div>
      <Button size="sm" variant="ghost" :label="__('Hide')" @click="hideList" />
    </div>
    <ul class="grid gap-3" :class="columns">
      <li v-for="task in tasks" :key="task.id">
        <button
          type="button"
          class="flex h-full w-full items-start gap-2.5 rounded-5 border border-outline-gray-1 bg-surface-elevation-1 p-3 text-start transition-colors hover:border-outline-gray-2 hover:bg-surface-gray-1 focus-visible:focus-ring dark:hover:bg-surface-elevation-2"
          @click="openTask(task)"
        >
          <span
            :class="
              task.done ? 'lucide-circle-check text-ink-green-5' : 'lucide-circle text-ink-gray-4'
            "
            class="mt-px size-4.5 shrink-0"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block text-base font-medium"
              :class="task.done ? 'text-ink-gray-5' : 'text-ink-gray-8'"
            >
              {{ task.title }}
              <span v-if="task.done" class="sr-only">{{ __('(done)') }}</span>
            </span>
            <span class="mt-1 block text-p-sm text-ink-gray-5">{{ task.description }}</span>
          </span>
        </button>
      </li>
    </ul>
  </section>

  <Dialog v-model:open="dialogOpen" :title="activeTask?.title">
    <DomainStep
      v-if="active === 'domain'"
      v-model:domain="domainName"
      v-model:domain-id="domainId"
      v-model:state="domainState"
      :supplied-domain="suppliedDomain"
    />
    <template v-else-if="active === 'team'">
      <TeamInviteStep
        v-if="cloud"
        ref="teamInvite"
        :domains="inviteDomains"
        @sent="
          (count) =>
            onInvited(count === 1 ? __('1 invitation sent') : __('{0} invitations sent', [count]))
        "
      />
      <InviteStep
        v-else
        ref="selfHostedInvite"
        :description="__('Separate addresses with commas. Everyone joins as a Normal User.')"
        @sent="onInvited"
      />
    </template>
    <WorkspaceBrandingForm
      v-else-if="active === 'logo'"
      ref="brandingForm"
      @saved="active = null"
    />
    <template #actions>
      <div class="flex justify-end gap-2">
        <template v-if="active === 'team'">
          <Button :label="__('Cancel')" @click="active = null" />
          <Button
            variant="solid"
            :label="__('Send invites')"
            :loading="inviting"
            :disabled="!canInvite"
            @click="sendInvites"
          />
        </template>
        <template v-else-if="active === 'logo'">
          <Button :label="__('Cancel')" @click="active = null" />
          <Button
            variant="solid"
            :label="__('Save')"
            :loading="brandingForm?.saving"
            :disabled="!brandingForm?.canSave"
            @click="brandingForm?.save()"
          />
        </template>
        <Button
          v-else
          :variant="domainState === 'verified' ? 'solid' : 'subtle'"
          :label="domainState === 'pending' ? __('Finish later') : __('Done')"
          @click="active = null"
        />
      </div>
    </template>
  </Dialog>
</template>
