import { describe, expect, it } from 'vitest'

import type { MailSettingsTabId } from '@/apps/mail'
import type { SettingsTabId } from '@/shell/settings/settings'

describe('settings tab ids', () => {
  it("Mail's own Settings opener takes only Mail tab ids", () => {
    // Runs under the type check. Mail's `openSettings` takes a MailSettingsTabId.
    const screener: MailSettingsTabId = 'mail.screener'
    const shared: SettingsTabId = screener
    // @ts-expect-error A misspelled Mail tab id fails the type check.
    const typo: MailSettingsTabId = 'mail.screner'
    // @ts-expect-error Another product's tab is not a Mail tab.
    const other: MailSettingsTabId = 'drive.statistics'
    expect([shared, typo, other]).toHaveLength(3)
  })
})
