<template>
  <Dropdown
    :options="accountOptions"
    :side="rail ? 'right' : 'top'"
    :align="rail ? 'end' : 'start'"
  >
    <button
      type="button"
      class="flex items-center rounded-4 focus-visible:focus-ring"
      :class="
        rail
          ? 'size-7 justify-center rounded-full'
          : 'h-10 w-full gap-3 px-2 text-left hover:bg-surface-gray-2'
      "
      :aria-label="__('Account')"
    >
      <Avatar
        :image="session.user.value?.avatar ?? undefined"
        :label="accountLabel"
        size="sm"
      />
      <span
        v-if="!rail"
        class="min-w-0 flex-1 truncate text-sm-medium text-ink-gray-8"
      >
        {{ accountLabel }}
      </span>
      <span
        v-if="!rail"
        class="lucide-chevron-up size-4 text-ink-gray-5"
        aria-hidden="true"
      />
    </button>
  </Dropdown>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Avatar, Dropdown } from "frappe-ui";

import { useSession } from "@/platform/session";
import { translate as __ } from "@/platform/translation";
import { useAccountMenu } from "@/shell/accountMenu";

withDefaults(defineProps<{ rail?: boolean }>(), { rail: false });

const session = useSession();
const accountOptions = useAccountMenu();
const accountLabel = computed(
  () => session.user.value?.fullName || session.user.value?.id || __("Account"),
);
</script>
