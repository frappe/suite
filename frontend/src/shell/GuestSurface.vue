<template>
  <!-- The guest frame: no rail, no area sidebar, no bottom nav, one slim header (spec §10.3, §10.12). -->
  <div class="flex h-full min-h-0 flex-col bg-surface-base text-ink-gray-8" data-testid="guest-frame">
    <header class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-outline-gray-1 px-3 sm:px-5">
      <div class="flex min-w-0 items-center gap-2">
        <img :src="suiteLogo" alt="" class="size-6 shrink-0" />
        <span class="truncate text-base-semibold text-ink-gray-9">Frappe Suite</span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <!-- The guest Uploads button's fixed slot (spec §10.6). The frame fills it only on folder routes. -->
        <div v-if="$slots.uploads" class="grid size-7 place-items-center">
          <slot name="uploads" />
        </div>
        <Button :label="__('Sign in')" @click="signIn" />
      </div>
    </header>

    <DesktopShell :scroll="scroll === 'shell'" class="min-h-0 flex-1">
      <section
        v-if="showSignIn"
        class="flex min-h-full items-center justify-center px-5 py-16"
        aria-labelledby="guest-sign-in-title"
      >
        <div class="w-full max-w-md text-center">
          <div class="mx-auto grid size-12 place-items-center rounded-full bg-surface-gray-2 text-ink-gray-5">
            <span class="lucide-log-in size-6" aria-hidden="true" />
          </div>
          <h1 id="guest-sign-in-title" class="mt-4 text-2xl-semibold text-ink-gray-9">
            {{ __("Sign in to open this") }}
          </h1>
          <Button class="mt-6" variant="solid" theme="gray" :label="__('Sign in')" @click="signIn" />
          <p class="mt-4 text-p-sm text-ink-gray-5">
            {{ __("If someone sent you a share link, open that link.") }}
          </p>
        </div>
      </section>
      <slot v-else />
    </DesktopShell>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, ref, useSlots, watch } from "vue";
import { Button, DesktopShell } from "frappe-ui";
import { useRoute } from "vue-router";

import { translate as __ } from "@/platform/translation";
import { GUEST_FRAME_KEY, type ScrollOwner } from "@/platform/contracts";
import { signInUrl } from "@/shell/guestFrame";

const suiteLogo = "/assets/suite/frontend/logo.svg";

withDefaults(defineProps<{ scroll?: ScrollOwner }>(), { scroll: "shell" });

defineSlots<{ default?: () => unknown; uploads?: () => unknown }>();

const route = useRoute();
const slots = useSlots();
const refused = ref(false);
// With no page to show, the frame shows the Sign-in screen: the URL stays and nothing says whether the item exists.
const showSignIn = computed(() => refused.value || !slots.default);

provide(GUEST_FRAME_KEY, {
  requireSignIn: () => {
    refused.value = true;
  },
});

watch(
  () => route.fullPath,
  () => {
    refused.value = false;
  },
);

function signIn() {
  window.location.assign(signInUrl(route.fullPath));
}

</script>
