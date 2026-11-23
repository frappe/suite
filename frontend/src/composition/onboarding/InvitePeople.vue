<!--
  Invite teammates, for setup and for Home. Suite Cloud gives each person a
  business mailbox on one of the site's domains; a self-hosted site invites by
  email through Frappe. The page that mounts it owns the buttons, so it calls
  `submit` and reads `working` and `canSubmit`.
-->
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import { translate as __ } from '@/platform/translation'
import InviteStep from '@/shell/InviteStep.vue'

import TeamInviteStep from './TeamInviteStep.vue'

const { cloud, domains } = defineProps<{
  cloud: boolean
  /** The site's invitation domains, the supplied one first. */
  domains: readonly string[]
}>()
const emit = defineEmits<{ sent: [summary: string] }>()

const teamInvite = useTemplateRef<InstanceType<typeof TeamInviteStep>>('teamInvite')
const selfHostedInvite = useTemplateRef<InstanceType<typeof InviteStep>>('selfHostedInvite')

const working = computed(() =>
  Boolean(cloud ? teamInvite.value?.working : selfHostedInvite.value?.loading),
)
const canSubmit = computed(() =>
  Boolean(cloud ? teamInvite.value?.canSubmit : selfHostedInvite.value?.canSubmit),
)

async function submit(): Promise<void> {
  if (cloud) await teamInvite.value?.submit()
  else await selfHostedInvite.value?.submit()
}

function onTeamSent(count: number): void {
  emit('sent', count === 1 ? __('1 invitation sent') : __('{0} invitations sent', [count]))
}

defineExpose({ working, canSubmit, submit })
</script>

<template>
  <TeamInviteStep v-if="cloud" ref="teamInvite" :domains="domains" @sent="onTeamSent" />
  <InviteStep
    v-else
    ref="selfHostedInvite"
    :description="__('Separate addresses with commas. Everyone joins as a Normal User.')"
    @sent="(summary) => emit('sent', summary)"
  />
</template>
