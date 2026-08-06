<template>
  <Dialog v-model:open="open" size="lg">
    <template #title>
      <div class="text-2xl-semibold text-ink-gray-8 flex text-nowrap overflow-hidden">
        Sharing "
        <div class="truncate max-w-[80%]">
          {{ file?.file_name }}
        </div>
        "
      </div>
    </template>
    <template #default>
      <div>
        <!-- General section -->
        <div class="border-b pb-5 mb-5">
          <div class="mb-2 text-ink-gray-5 text-sm">General access</div>
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-col items-start gap-2">
              <Select v-model="generalAccessLevel" variant="outline" :options="levelOptions" :disabled="!generalAccessLoaded" @update:model-value="
                (val) => updateGeneralAccess(val, generalPerms)
              " />
            </div>
            <AccessSelect v-if="generalAccessLevel !== 'restricted'" v-model="generalPerms" variant="outline" :options="accessOptions" :disabled="!generalAccessLoaded"
              @update:model-value="
                (val) => updateGeneralAccess(generalAccessLevel, val)
              " />
          </div>
        </div>
        <!-- Members section -->
        <div class="text-ink-gray-5 text-sm mb-2">Members</div>
        <div class="flex items-start gap-2 rounded bg-surface-white p-1.5 ring-1 ring-outline-gray-2 mb-4">
          <TagInput autofocus v-model="usersToAdd" v-model:options="filteredUsers" class="flex-1 min-w-0" :render-icon="(k) =>
            k.is_group
              ? h(LucideUsers, { class: 'size-3.5 text-ink-gray-6' })
              : h(Avatar, {
                image: k.user_image,
                label: k.value,
                size: 'xs',
              })
            " placeholder="Add people or groups" />
          <AccessSelect v-if="usersToAdd.length" v-model="accessToAdd" variant="ghost" :options="accessOptions" />
        </div>

        <div v-if="usersWithAccess.data"
          class="flex flex-col gap-3 overflow-y-auto text-base max-h-64 py-1 overflow-auto">
          <div v-for="(user, idx) in usersWithAccess.data" :key="user.name" class="flex items-center gap-3 pr-1">
            <div v-if="user.is_group"
              class="size-7 shrink-0 rounded-full bg-surface-gray-3 flex items-center justify-center">
              <LucideUsers class="size-4 text-ink-gray-7" />
            </div>
            <Avatar v-else size="xl" :label="user.user || user.email" :image="user.user_image" />

            <div class="flex items-start flex-col gap-1">
              <span class="text-base-medium text-ink-gray-9">{{
                user.is_group ? groupName(user.user) : user.full_name || user.user || user.email
                }}</span>
              <span v-if="user.is_group" class="text-ink-gray-7 text-sm">{{
                peopleLabel(groupCount(user.user)) }}</span>
              <span v-else-if="user.full_name && user.full_name !== (user.user || user.email)"
                class="text-ink-gray-7 text-sm">{{ user.user || user.email }}</span>
            </div>
            <div class="ml-auto flex w-28 shrink-0 items-center justify-end">
              <span v-if="user.user == currentUserId" class="mr-1 text-ink-gray-7">
                <template v-if="user.user === file.owner">Owner (you)</template>
                <template v-else>You</template>
              </span>
              <AccessSelect v-else-if="user.user !== file.owner" variant="ghost" :modelValue="user.write ? 'editor' : user.upload ? 'upload' : 'reader'
                " :options="[...accessOptions, REMOVE_OPTION]" @update:model-value="
                  (val) => updatePermissions(user, val, file.name, idx)
                " />
              <span v-else class="flex items-center gap-1 text-ink-gray-5">
                Owner
                <span class="lucide-diamond size-3" aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
        <div v-else class="flex flex-col gap-3 min-h-44 py-1">
          <div v-for="i in 3" :key="i" class="flex items-center gap-3 pr-1">
            <Skeleton class="size-10 rounded-full shrink-0" />
            <div class="flex flex-col gap-1.5 flex-1">
              <Skeleton class="h-3.5 rounded w-28" />
              <Skeleton class="h-3 rounded w-36" />
            </div>
            <Skeleton class="ml-auto h-7 w-20 rounded" />
          </div>
        </div>
        <!-- match the card's pb-6 so the footer is vertically centered -->
        <div class="w-full flex items-center justify-end mt-8">
          <div class="flex gap-2">
            <Button variant="outline" icon-left="lucide-link-2" label="Copy link" @click="getFileLink(file)" />
            <Button v-if="usersToAdd.length" label="Invite" variant="solid" @click="inviteUsers" />
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>
<script setup>
import { ref, computed, watch, h } from 'vue'
import { useSessionStore } from '@/boot/session'
import {
  Avatar,
  Dialog,
  Select,
  Skeleton,
  createResource,
  toast,
  Button,
} from 'frappe-ui'
import AccessSelect from './AccessSelect.vue'
import TagInput from './TagInput/TagInput.vue'
import { getUserGroups } from '@/apps/drive/resources/permissions'
import LucideUsers from '~icons/lucide/users'
import { getFileLink, dynamicList } from '../js/utils'

import { usersWithAccess, updateAccess, allUsers } from '../js/resources'


const currentUserId = computed(() => useSessionStore().user)

const open = defineModel()
const props = defineProps({
  file: Object,
  users: {
    default: allUsers,
  },
  usersWithAccess: { default: usersWithAccess },
  updateAccess: { default: updateAccess },
  /** Highest access level offered by the dialog ('reader' | 'upload' | 'editor'). */
  allowedAccess: { type: String, default: 'editor' },
})
const emit = defineEmits(['success'])

props.usersWithAccess.fetch({ entity: props.file.name })
props.users.fetch()
getUserGroups.fetch()

const levelOptions = [
  {
    label: 'Accessible to invited members',
    value: 'restricted',
    icon: 'lucide-lock',
  },
  {
    label: 'Accessible to all site users',
    value: 'site',
    icon: 'lucide-building-2',
  },
  { label: 'Accessible to all', value: 'public', icon: 'lucide-globe-2' },
]

const ACCESS_RANK = { reader: 0, upload: 1, editor: 2 }
const REMOVE_OPTION = {
  value: 'remove',
  label: 'Remove',
  icon: 'lucide-trash-2',
}

const accessOptions = computed(() =>
  dynamicList([
    { value: 'reader', label: 'Can view', icon: 'lucide-eye' },
    {
      value: 'upload',
      label: 'Can upload',
      cond: props.file.is_folder && props.file.upload,
      icon: 'lucide-upload',
    },
    {
      value: 'editor',
      label: 'Can edit',
      cond: props.file.write,
      icon: 'lucide-pencil',
    },
  ]).map((opt) => ({
    ...opt,
    disabled: ACCESS_RANK[opt.value] > ACCESS_RANK[props.allowedAccess],
  })),
)

// General access: '' rows are public (anyone with the link), $GENERAL rows
// cover all logged-in site users; restricted writes explicit deny rows.
const generalAccessLevel = ref(levelOptions[0].value)
const generalPerms = ref('reader')
const generalAccessLoaded = ref(false)

createResource({
  url: 'suite.drive.api.permissions.get_general_access',
  params: { entity: props.file.name },
  auto: true,
  onSuccess(data) {
    generalAccessLevel.value = data.type
    if (data.read) {
      generalPerms.value = data.write
        ? 'editor'
        : data.upload
          ? 'upload'
          : 'reader'
    }
    generalAccessLoaded.value = true
  },
  onError(error) {
    toast.error(error.messages?.at(-1) || 'Could not load general access.')
  },
})
const updateGeneralAccess = (level, perms) => {
  if (level !== 'restricted') {
    props.updateAccess.submit({
      entity_name: props.file.name,
      user: level === 'public' ? '' : '$GENERAL',
      read: 1,
      comment: 1,
      share: 1,
      write: perms === 'editor',
      upload: perms === 'editor' || perms === 'upload',
    })
  } else {
    props.updateAccess.submit({
      entity_name: props.file.name,
      user: '$GENERAL',
      method: 'unshare',
    })
  }
  emit('success')
}

// Invite specific users
const usersToAdd = ref([])
const accessToAdd = ref('reader')
const filteredUsers = ref([])
const peopleLabel = (n) => `${n} ${n === 1 ? 'person' : 'people'}`
const groupName = (v) => (v || '').replace(/^\$GROUP:/, '')
const groupCount = (v) =>
  getUserGroups.data?.find((g) => g.value === v)?.member_count ?? 0

watch(
  [
    () => props.users.data,
    () => props.usersWithAccess.data,
    () => getUserGroups.data,
  ],
  ([users, existingUsers, groups]) => {
    if (!existingUsers || !users) return []
    const taken = (v) => existingUsers.find(({ user }) => user === v)
    filteredUsers.value = [
      ...(groups || [])
        .filter((g) => !taken(g.value))
        .map((g) => ({ ...g, description: peopleLabel(g.member_count) })),
      ...users.filter((k) => !taken(k.name)),
    ]
  },
  // deep: removals/invites splice/push `usersWithAccess.data` in place
  { immediate: true, deep: true },
)

const inviteUsers = () => {
  const access = getAccess(accessToAdd.value)
  for (let user of usersToAdd.value) {
    const r = {
      entity_name: props.file.name,
      user,
      ...access,
    }
    props.updateAccess.submit(r)
    const userObj = filteredUsers.value.find((k) => k.value === user)
    // For new records
    if (!userObj.is_group && !userObj.email) userObj.email = userObj.label
    props.usersWithAccess.data.push({
      ...userObj,
      user,
      ...access,
    })
  }
  usersToAdd.value = []
  emit('success')
}

const updatePermissions = (user, val, entity_name, idx) => {
  if (val === 'remove') {
    props.usersWithAccess.data.splice(idx, 1)
    return props.updateAccess.submit({
      method: 'unshare',
      entity_name,
      user: user.user,
    })
  }
  const access = getAccess(val)
  Object.assign(user, access)
  props.updateAccess.submit({
    entity_name,
    user: user.user,
    ...access,
  })
}

// Util functions
const getAccess = (val) => ({
  read: 1,
  comment: 1,
  upload: val === 'upload' || val === 'editor' ? 1 : 0,
  share: val === 'editor' ? 1 : 0,
  write: val === 'editor' ? 1 : 0,
})
</script>
