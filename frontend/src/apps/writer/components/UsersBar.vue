<template>
  <Dropdown placement="right" :options="users">
    <template #default>
      <div class="ml-2.5 flex items-center rounded-md cursor-pointer">
        <div
          v-for="user in users.slice(0, 3)"
          :key="user.name"
          class="-ml-2.5 -py-0.5 flex items-center rounded-full"
        >
          <Avatar
            class="-"
            :size="'md'"
            :style="{
              border: '1.5px solid',
              borderRadius: '100%',
              borderColor: user.color,
            }"
            :image="user.avatar"
            :label="user.name"
            :title="user.name"
          />
        </div>
        <div
          v-if="users.length > 3"
          :style="{ marginLeft: '-0.625rem', fontSize: '10px' }"
          class="relative inline-block shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-5 text-xs cursor-pointer border-[1.5px] border-gray-300"
          :title="`${users.length - 3} more users`"
        >
          +{{ users.length - 3 }}
        </div>
      </div>
    </template>
    <template #item="{ item }">
      <div
        class="flex items-center justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-surface-gray-1 focus:outline-none"
      >
        <div class="flex gap-2 items-center">
          <Avatar
            :size="'md'"
            :image="item.avatar"
            :label="item.name"
            :title="item.name"
          />
          <div class="text-sm text-ink-gray-8 mr-4 flex flex-col gap-0.5">
            <span>{{ item.name }}</span>
            <span class="text-xs text-ink-gray-5">{{ item.id }}</span>
          </div>
        </div>
        <svg
          class="ml-auto"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="8"
            cy="8"
            r="4.5"
            fill="transparent"
            :stroke="item.color"
            stroke-width="3"
          />
        </svg>
      </div>
    </template>
  </Dropdown>
</template>
<script setup>
import { Avatar, Dropdown } from 'frappe-ui'

defineProps({
  users: Array,
})
</script>
