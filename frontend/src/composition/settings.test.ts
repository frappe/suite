import { describe, expect, it } from 'vitest'

import type { MailSettingsTabId } from '@/apps/mail'
import type { openSettings } from '@/platform/settings'
import type { SettingsTabId } from '@/shell/settings/settings'

/** The sections Settings can be opened on, for one tab. */
type SectionOf<Tab extends SettingsTabId> = NonNullable<Parameters<typeof openSettings<Tab>>[1]>

describe('settings tab ids', () => {
  it("Mail's own Settings opener takes only Mail tab ids", () => {
    // Runs under the type check. Mail's `openSettings` takes a MailSettingsTabId.
    const inbox: MailSettingsTabId = 'mail.inbox'
    const shared: SettingsTabId = inbox
    // @ts-expect-error A misspelled Mail tab id fails the type check.
    const typo: MailSettingsTabId = 'mail.inbx'
    // @ts-expect-error Another product's tab is not a Mail tab.
    const other: MailSettingsTabId = 'drive.statistics'
    expect([shared, typo, other]).toHaveLength(3)
  })
  it('a section is opened only on the tab that has it', () => {
    // Runs under the type check, like the test above
    const own: SectionOf<'mail.import-export'> = 'import'
    // @ts-expect-error A misspelled section fails the type check
    const typo: SectionOf<'mail.import-export'> = 'imprt'
    // @ts-expect-error A section of another tab is not this tab's
    const other: SectionOf<'mail.sending'> = 'import'
    expect([own, typo, other]).toHaveLength(3)
  })
})
