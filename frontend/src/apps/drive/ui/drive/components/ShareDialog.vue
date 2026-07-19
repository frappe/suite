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
              <Select v-model="generalAccessLevel" variant="outline" :options="levelOptions" @update:model-value="
                (val) => updateGeneralAccess(val, generalPerms)
              " />
              <TeamSelector v-if="generalAccessLevel == 'team'" v-model="chosenTeam" variant="outline" />
            </div>
            <AccessSelect v-if="generalAccessLevel !== 'restricted'" v-model="generalPerms" variant="outline" :options="accessOptions"
              @update:model-value="
                (val) => updateGeneralAccess(generalAccessLevel, val)
              " />
          </div>
        </div>
        <!-- Members section -->
        <div class="text-ink-gray-5 text-sm mb-2">Members</div>
        <div class="flex items-start gap-2 rounded bg-surface-white p-1.5 ring-1 ring-outline-gray-2 mb-4">
          <TagInput autofocus v-model="usersToAdd" v-model:options="filteredUsers" class="flex-1 min-w-0" :render-icon="(k) =>
            h(Avatar, {
              image: k.user_image,
              label: k.value,
              size: 'xs',
            })
            " placeholder="Add people" />
          <AccessSelect v-if="usersToAdd.length" v-model="accessToAdd" variant="ghost" :options="accessOptions" />
        </div>

        <div v-if="usersWithAccess.data"
          class="flex flex-col gap-3 overflow-y-auto text-base max-h-64 py-1 overflow-auto">
          <div v-for="(user, idx) in usersWithAccess.data" :key="user.name" class="flex items-center gap-3 pr-1">
            <Avatar size="xl" :label="user.user || user.email" :image="user.user_image" />

            <div class="flex items-start flex-col gap-1">
              <span class="text-base-medium text-ink-gray-9">{{
                user.full_name || user.user || user.email
                }}</span>
              <span v-if="user.full_name && user.full_name !== (user.user || user.email)"
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
  useCall,
  Button,
} from 'frappe-ui'
import AccessSelect from './AccessSelect.vue'
import TeamSelector from './TeamSelector.vue'
import TagInput from './TagInput/TagInput.vue'
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
props.users.fetch({ team: 'all' })

const levelOptions = [
  {
    label: 'Accessible to invited members',
    value: 'restricted',
    icon: 'lucide-lock',
  },
  {
    label: 'Accessible to a team',
    value: 'team',
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

// General access
const generalAccessLevel = ref(levelOptions[0].value)
const generalPerms = ref('reader')
const chosenTeam = ref()

let generalParams = {}
const getGeneralAccess = useCall({
  url: '/api/v2/method/suite.drive.api.permissions.get_user_access',
  immediate: false,
  onSuccess: (data) => {
    if (!data || !data.read) {
      if (generalParams.user === 'Guest') fetchGeneralAccess({ team: 1 })
      return
    }
    generalAccessLevel.value = generalParams.team ? 'team' : 'public'
    chosenTeam.value = data.team
    generalPerms.value = data.write
      ? 'editor'
      : data.upload
        ? 'upload'
        : 'reader'
  },
})
const fetchGeneralAccess = (params) => {
  generalParams = params
  getGeneralAccess.submit({ entity: props.file.name, ...params })
}
fetchGeneralAccess({ user: 'Guest' })
let selectingTeam = false
const updateGeneralAccess = (level, perms) => {
  if (level === 'team' && !chosenTeam.value) {
    selectingTeam = true
    return
  }
  if (level !== 'restricted') {
    props.updateAccess.submit({
      entity_name: props.file.name,
      user: level === 'public' ? '' : chosenTeam.value,
      team: level === 'team',
      read: 1,
      comment: 1,
      share: 1,
      write: perms === 'editor',
      upload: perms === 'editor' || perms === 'upload',
    })
    selectingTeam = false
  } else {
    props.updateAccess.submit({
      entity_name: props.file.name,
      user: '$GENERAL',
      method: 'unshare',
    })
  }
  emit('success')
}

watch(
  chosenTeam,
  (now, prev) =>
    (prev || selectingTeam) &&
    updateGeneralAccess(generalAccessLevel.value, generalPerms.value),
)

// Invite specific users
const usersToAdd = ref([])
const accessToAdd = ref('reader')
const filteredUsers = ref([])
watch(
  [() => props.users.data, () => props.usersWithAccess.data],
  ([users, existingUsers]) => {
    if (!existingUsers || !users) return []
    filteredUsers.value = users.filter(
      (k) => !existingUsers.find(({ user }) => user === k.name),
    )
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
    if (!userObj.email) userObj.email = userObj.label
    props.usersWithAccess.data.push({
      ...userObj,
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
