# Stage 5 release note: changes with both keys off

With `suite_flip_shell` and `suite_flip_files` off, users still see these
changes. No key reverts them (spec section 14.2). The tag at the end of each
line names the stage that made the change.

## Every app

- Reinstall the Suite app. The installed app has a new identity (manifest
  `id` `/mail` becomes `/suite`). A phone or computer that installed Suite
  now shows two apps. Remove the old one and install again. (stage 5)
- The browser can install Frappe Suite from any Suite page, not only from
  Mail and Calendar. (stage 5)
- Mail push notifications start when you sign in, on any Suite page, not
  only when you open Mail. A push that arrives while a Suite tab is in front
  shows as a notification on any page. Many open tabs show it once. (stage 5)
- A click on a push notification opens its page in every browser, not only
  Chrome. It focuses a Suite tab that already shows the page. (stage 5)
- Log out from the Suite user menu stops this browser's mail pushes. After
  any log out, the next user who signs in on the same browser gets only
  their own pushes. (stage 5)
- Cmd+Shift+L no longer changes the theme. Cmd+Shift+K does, or change it
  in Settings > Account > Preferences. (stage 3)
- Desk is no longer in the Apps menu. (stage 4)
- `/home` and `/d/<id>` open for a signed-in user who types the address.
  (stage 6)

## Mail

- Settings opens the Suite settings dialog. On a phone it opens on
  Credentials. (stage 5)
- `/mail` opens the inbox again. Old short links work again. (stage 5)
- The sidebar header has no logo and always says "Mail". The line under it
  shows the active mail account. (stage 5)
- A user without a mailbox who opens Mail sees a "Mail is unavailable" page
  instead of being sent to Desk. A MIME message page still opens for that
  user. (stage 5)

## Calendar

- Settings opens the Suite settings dialog on Calendars. (stage 5)
- The sidebar header says "Calendar" above the account. A collapsed sidebar
  keeps an icon that opens the menu. (stage 5)
- Home > Upcoming shows events again. (stage 5)

## Meet

- The sidebar header shows only the title "Meet": no logo and no user name.
  A collapsed sidebar keeps an icon that opens the menu. (stage 5)
- Settings opens the Suite settings dialog on Meet > Devices. (stage 5)

## Found in stage 5, not planned

These are regressions from today. They need a decision before the release.

- Fixed: Search did not open. The sidebar Search item and Ctrl+K / Cmd+K
  did nothing, the phone offer to install Suite was gone, and Cmd+Shift+K
  (theme) and Cmd+Shift+Comma (Settings) had no key binding. Cause:
  `App.vue` no longer mounted `shell/SuiteLayout.vue`, which held the
  command palette, the install offer and these two shortcuts (commit
  61b6401e4, before this run). `SuiteLayout.vue` is now deleted.
  `ShellLayout` mounts the palette and the install offer in every state.
  The palette binds Cmd+Shift+K and the Settings dialog binds
  Cmd+Shift+Comma.
- Mail on a phone has no Push Notifications switch. Stage 4 deleted it with
  Mail's phone settings page, and no Settings tab replaces it. Existing
  subscriptions still deliver.
