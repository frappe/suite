<template>
  <Dialog v-model:open="open" :title="title" size="md">
    <div v-if="change" class="space-y-3">
      <ul v-if="change.gains.length" class="-my-1 max-h-72 overflow-y-auto overscroll-contain">
        <li v-for="gain in change.gains" :key="gain.principal" class="flex h-11 items-center gap-3">
          <Avatar
            v-if="gain.person"
            size="xl"
            :image="gain.person.user_image ?? undefined"
            :label="gain.label"
            class="shrink-0"
          />
          <span
            v-else
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
            aria-hidden="true"
          >
            <span :class="[GAIN_ICONS[principalKind(gain.principal)], 'size-4']" />
          </span>
          <span class="min-w-0 flex-1 truncate text-base text-ink-gray-8" :title="gain.label">
            {{ gain.label }}
          </span>
          <span class="shrink-0 text-base text-ink-gray-5">{{ abilityLabel(gain.role) }}</span>
        </li>
      </ul>
      <p v-if="ownAccess" class="text-p-base text-ink-gray-7">{{ ownAccess }}</p>
    </div>
    <template #actions>
      <div class="flex justify-end gap-2">
        <Button :label="__('Cancel')" @click="open = false" />
        <Button variant="solid" theme="gray" :label="__('Move')" @click="confirmMove" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Avatar, Button, Dialog } from 'frappe-ui'
import { computed } from 'vue'

import { principalKind, roleLabel } from '@/apps/drive/client/grants'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import type { MoveAccessChange } from './folderPicker'

const ABILITY_LABELS = new Map<number, () => string>([
  [DRIVE_ROLES.read, () => __('Can view')],
  [DRIVE_ROLES.comment, () => __('Can comment')],
  [DRIVE_ROLES.upload, () => __('Can upload')],
  [DRIVE_ROLES.edit, () => __('Can edit')],
  [DRIVE_ROLES.manage, () => __('Can manage')],
])

function abilityLabel(role: number): string {
  return ABILITY_LABELS.get(role)?.() ?? __(roleLabel(role))
}

const GAIN_ICONS: Record<ReturnType<typeof principalKind>, string> = {
  user: 'lucide-user',
  group: 'lucide-users',
  general: 'lucide-building-2',
  public: 'lucide-globe',
  link: 'lucide-link',
}

const props = defineProps<{ change: MoveAccessChange | null }>()
const emit = defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>('open', { required: true })

const title = computed(() =>
  props.change?.gains.length ? __('More people will get access') : __('Your access will change'),
)
const ownAccess = computed(() => {
  const role = props.change?.ownRoleAfter
  if (role === null || role === undefined) return null
  return role > 0
    ? __("You'll have {0} access.", [__(roleLabel(role))])
    : __("You'll no longer have access.")
})

function confirmMove() {
  open.value = false
  emit('confirm')
}
</script>
