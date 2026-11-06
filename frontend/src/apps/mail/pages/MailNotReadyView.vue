<!--
  Where /mail lands while the account has no folder to open: its mailboxes are
  not set up yet, or the mail server did not list them. A server outage shows
  MailLayout's own page instead. Try again loads Mail afresh.
-->
<template>
  <section
    role="status"
    class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
    aria-labelledby="mail-not-ready-title"
  >
    <span class="lucide-inbox size-10 text-ink-gray-5" aria-hidden="true" />
    <div class="flex flex-col gap-1.5">
      <h1 id="mail-not-ready-title" class="text-xl font-semibold text-ink-gray-9">
        {{ __('Your mailbox is not ready') }}
      </h1>
      <p class="text-base text-ink-gray-6">
        {{
          __(
            'Mail could not find the folders of this account. If the account is new, try again in a few minutes.',
          )
        }}
      </p>
    </div>
    <Button variant="solid" @click="tryAgain">{{ __('Try again') }}</Button>
  </section>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

import { useShellPhoneChrome } from '@/platform/phone-chrome'
import { translate as __ } from '@/platform/translation'

// Mail owns its phone chrome, and this page has none: the shell's bottom nav lets the
// reader switch areas.
useShellPhoneChrome()

const tryAgain = () => window.location.assign('/mail')
</script>
