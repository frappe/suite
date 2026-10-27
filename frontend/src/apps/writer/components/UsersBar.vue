<template>
  <Dropdown align="end" :options="users">
    <template #default>
      <button
        type="button"
        class="flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-4 px-1 cursor-pointer"
        :aria-label="buttonLabel"
      >
        <div
          v-for="user in shownUsers"
          :key="user.name"
          class="peer-slot flex items-center rounded-full"
          :class="{ 'peer-idle': isIdle(user) }"
        >
          <Tooltip :text="tooltipOf(user)">
            <Avatar
              v-if="user.avatar"
              class="peer-avatar"
              :size="'sm'"
              :image="user.avatar"
              :label="user.name"
            />
            <span v-else class="peer-colour peer-chip peer-initials" :style="peerColourStyle(user)">
              {{ initialsOf(user.name) }}
            </span>
          </Tooltip>
        </div>
        <Tooltip v-if="hasHiddenUsers" :text="moreUsersLabel">
          <div class="peer-chip bg-surface-gray-2 text-ink-gray-5">+{{ hiddenCount }}</div>
        </Tooltip>
      </button>
    </template>
    <template #item="{ item }">
      <div
        class="flex items-center gap-2 py-1.5 px-2 rounded-4 cursor-pointer hover:bg-surface-gray-1 focus:outline-none"
      >
        <Avatar v-if="item.avatar" :size="'md'" :image="item.avatar" :label="item.name" />
        <span
          v-else
          class="peer-colour peer-chip peer-chip-md peer-initials"
          :style="peerColourStyle(item)"
          aria-hidden="true"
        >
          {{ initialsOf(item.name) }}
        </span>
        <div class="text-sm text-ink-gray-8 mr-4 flex flex-col gap-0.5">
          <span>{{ item.name }}</span>
          <span v-if="emailOf(item)" class="text-xs text-ink-gray-5">{{ emailOf(item) }}</span>
        </div>
      </div>
    </template>
  </Dropdown>
</template>
<script setup>
import { Avatar, Dropdown, Tooltip } from 'frappe-ui'
import { computed, onBeforeUnmount, ref } from 'vue'

import { colourStyle } from '@/apps/writer/collab/colours'
import { initialsOf } from '@/apps/writer/collab/peers'
import { useUsers } from '@/apps/writer/composables/useUsers'

const props = defineProps({
  users: Array,
})

const { getUser } = useUsers()

const MINUTE_MS = 60_000
const TICK_MS = 30_000
const SHOWN_USERS = 3
// An idle person's tooltip counts the minutes, so it is redrawn as they pass
const now = ref(Date.now())
function tick() {
  now.value = Date.now()
}

const ticker = setInterval(tick, TICK_MS)
onBeforeUnmount(() => clearInterval(ticker))

const buttonLabel = computed(() => {
  if (props.users.length === 1) {
    return __('{0} is here', [props.users[0].name])
  }

  return __('{0} other people here', [props.users.length])
})

const shownUsers = computed(() => props.users.slice(0, SHOWN_USERS))
const hiddenCount = computed(() => props.users.length - SHOWN_USERS)
const hasHiddenUsers = computed(() => hiddenCount.value > 0)

const moreUsersLabel = computed(() => {
  if (hiddenCount.value === 1) {
    return __('1 more user')
  }

  return __('{0} more users', [hiddenCount.value])
})

function isIdle(user) {
  return user.idleSince != null
}

function tooltipOf(user) {
  if (!isIdle(user)) {
    return user.name
  }

  const minutes = Math.max(1, Math.floor((now.value - user.idleSince) / MINUTE_MS))
  return __('{0} · Idle for {1} min', [user.name, minutes])
}

// A second line only when it tells more than the name: a guest has no email, and a user id can equal the name
function emailOf(user) {
  const email = getUser(user.id)?.email
  return email && email !== user.name ? email : ''
}

// A collaborative document's person has a colour with a dark-mode variant; the older editor's has one colour,
// which fills its initials in white
function peerColourStyle(user) {
  if (user.colour) {
    return colourStyle(user.colour)
  }

  return {
    '--peer-light': user.color,
    '--peer-dark': user.color,
    '--peer-light-tint': user.color,
    '--peer-dark-tint': user.color,
    '--peer-light-ink': '#ffffff',
    '--peer-dark-ink': '#ffffff',
  }
}
</script>

<style scoped>
/* Dimmed while the person is idle */
.peer-idle {
  opacity: 0.45;
}

.peer-avatar {
  border-radius: 50%;
}

.peer-chip {
  align-items: center;
  border-radius: 50%;
  display: inline-flex;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  height: 20px;
  justify-content: center;
  width: 20px;
}

/* As large as the list's photo avatars */
.peer-chip-md {
  font-size: 11px;
  height: 24px;
  width: 24px;
}

/* Drawn like the person's caret flag: their tint, their name's ink */
.peer-initials {
  background-color: var(--peer-tint);
  color: var(--peer-ink);
}
</style>
