<!--
  The suite's own bar: what scopes everything below it, and nothing that
  belongs to a single app.

  Its left block is exactly as wide as the sidebar, so the workspace name
  stands over the app list it scopes rather than floating between columns.
-->
<template>
  <header
    class="flex h-12 shrink-0 items-center gap-3 border-b border-outline-gray-1 bg-surface-base px-2"
  >
    <!-- Always the rail's width, pinned or not: the workspace stays exactly
         where it was when the rail comes and goes, and there is no control up
         here that belongs to the rail. -->
    <div class="flex w-60 shrink-0 items-center">
      <WorkspaceSwitcher />
    </div>

    <div class="flex min-w-0 flex-1 justify-center">
      <div class="w-full max-w-[34rem]">
        <SearchTrigger />
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      <!-- Notifications only: Settings reached the bar twice over, and the
           account menu in the rail is the one that owns it. -->
      <Tooltip content="Notifications" placement="bottom">
        <Button variant="ghost" icon="lucide-bell" aria-label="Notifications" />
      </Tooltip>

      <!-- The rail's footer owns the account while the rail is pinned. Unpin
           it and the rail takes the shell's only avatar with it, leaving every
           app but Mail with no way to reach your own account — so it surfaces
           here for exactly as long as the rail is away. -->
      <Dropdown v-if="!sidebarOpen" :options="ACCOUNT_OPTIONS" align="end">
        <button
          type="button"
          class="ml-1 flex items-center rounded-full"
          :aria-label="USER.name"
        >
          <Avatar size="sm" :image="USER.avatar" :label="USER.name" />
        </button>
      </Dropdown>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Avatar, Button, Dropdown, Tooltip } from 'frappe-ui'

import { ACCOUNT_OPTIONS } from '../accountMenu'
import { USER } from '../fixtures'
import { sidebarOpen } from '../useSidebar'
import SearchTrigger from './SearchTrigger.vue'
import WorkspaceSwitcher from './WorkspaceSwitcher.vue'
</script>
